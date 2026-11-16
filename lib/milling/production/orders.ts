import { Prisma, type PrismaClient } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";

import { millRefusal } from "../errors";
import { nextDailyCode } from "../records/codes";
import { releaseReservation, reserve } from "../stock/ledger";

/**
 * Production planning (plan 4.2): what to make, on which day and shift.
 *
 * Submitting works out the maize needed; approving reserves it, oldest
 * available lots first, so nothing else takes it. If maize or bags are short,
 * management may still approve, and saying so is recorded.
 */

type Tx = Prisma.TransactionClient;
export const ORDER_ENTITY = "MillingProductionOrder";

const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

export interface OrderLineInput {
  productId: string;
  bags?: number | null;
  kg?: number | null;
}

export interface Requirements {
  outputKg: Prisma.Decimal;
  maizeKg: Prisma.Decimal;
  maizeAvailableKg: Prisma.Decimal;
  /** Bags and thread the packed lines need, against what is free. */
  packaging: Array<{ productId: string; name: string; needed: Prisma.Decimal; available: Prisma.Decimal }>;
  short: string[];
}

async function freeOf(tx: Tx | PrismaClient, companyId: string, productId: string) {
  const balances = await tx.millingLotBalance.findMany({
    where: { companyId, lot: { productId, status: "AVAILABLE" } },
    select: { quantity: true, reserved: true },
  });
  return balances.reduce((sum, row) => sum.plus(row.quantity).minus(row.reserved), D(0));
}

/** Kg of each line: bags x the product's net weight for packed products. */
async function resolveLines(tx: Tx | PrismaClient, companyId: string, lines: OrderLineInput[]) {
  if (!lines.length) throw millRefusal("Add at least one product to make.");
  const products = await tx.product.findMany({
    where: { companyId, id: { in: lines.map((line) => line.productId) } },
    select: { id: true, name: true, unit: true, netWeightKg: true },
  });
  return lines.map((line) => {
    const product = products.find((entry) => entry.id === line.productId);
    if (!product) throw millRefusal("A line names a product that is not in this workspace.");
    if (product.unit === "BAG") {
      if (!line.bags || line.bags <= 0 || !Number.isInteger(line.bags)) throw millRefusal(`Enter the bags of ${product.name} to make.`);
      if (!product.netWeightKg) throw millRefusal(`${product.name} has no net weight; set it in Products.`);
      return { productId: product.id, bags: line.bags, kg: product.netWeightKg.times(line.bags) };
    }
    if (!line.kg || line.kg <= 0) throw millRefusal(`Enter the kg of ${product.name} to make.`);
    return { productId: product.id, bags: null, kg: D(line.kg) };
  });
}

export async function requirementsFor(
  db: Tx | PrismaClient,
  companyId: string,
  lines: Array<{ productId: string; bags: number | null; kg: Prisma.Decimal }>,
): Promise<Requirements> {
  const settings = await db.millingSettings.findUnique({ where: { companyId } });
  const lossPct = D(settings?.plannedLossPct ?? 3);
  const outputKg = lines.reduce((sum, line) => sum.plus(line.kg), D(0));
  const maizeKg = outputKg.div(D(1).minus(lossPct.div(100))).toDecimalPlaces(0, Prisma.Decimal.ROUND_UP);
  const maize = await db.product.findFirst({ where: { companyId, code: "MAIZE" }, select: { id: true } });
  const maizeAvailableKg = maize ? await freeOf(db, companyId, maize.id) : D(0);

  const recipes = await db.millingPackRecipe.findMany({
    where: { companyId, packedProductId: { in: lines.filter((line) => line.bags).map((line) => line.productId) }, isActive: true },
  });
  const needs = new Map<string, Prisma.Decimal>();
  for (const line of lines) {
    const recipe = recipes.find((entry) => entry.packedProductId === line.productId);
    if (!recipe || !line.bags) continue;
    if (recipe.bagProductId) needs.set(recipe.bagProductId, (needs.get(recipe.bagProductId) ?? D(0)).plus(line.bags));
    if (recipe.threadPerBag) {
      const thread = await db.product.findFirst({ where: { companyId, code: "THREAD" }, select: { id: true } });
      if (thread) needs.set(thread.id, (needs.get(thread.id) ?? D(0)).plus(recipe.threadPerBag.times(line.bags)));
    }
  }
  const names = await db.product.findMany({ where: { companyId, id: { in: [...needs.keys()] } }, select: { id: true, name: true } });
  const packaging = await Promise.all(
    [...needs.entries()].map(async ([productId, needed]) => ({
      productId,
      name: names.find((entry) => entry.id === productId)?.name ?? "",
      needed,
      available: await freeOf(db, companyId, productId),
    })),
  );
  const short = [
    ...(maizeAvailableKg.lt(maizeKg) ? [`maize (${maizeAvailableKg.toFixed(0)} of ${maizeKg.toFixed(0)} kg free)`] : []),
    ...packaging.filter((row) => row.available.lt(row.needed)).map((row) => `${row.name} (${row.available.toString()} of ${row.needed.toString()} free)`),
  ];
  return { outputKg, maizeKg, maizeAvailableKg, packaging, short };
}

async function orderOrThrow(tx: Tx, companyId: string, orderId: string) {
  await tx.$queryRaw`SELECT "id" FROM "MillingProductionOrder" WHERE "id" = ${orderId} FOR UPDATE`;
  const order = await tx.millingProductionOrder.findFirst({ where: { id: orderId, companyId }, include: { lines: true } });
  if (!order) throw millRefusal("That production order is not in this workspace.");
  return order;
}

async function audit(tx: Tx, companyId: string, actorId: string, id: string, action: string, payload?: Record<string, unknown>, reason?: string) {
  await writePlatformAuditEvent({ companyId, actorId, eventType: `milling.order.${action}`, entityType: ORDER_ENTITY, entityId: id, payload, reason }, tx);
}

export async function createOrder(
  db: PrismaClient,
  args: { companyId: string; userId: string; productionDate: string; shiftKind: "DAY" | "NIGHT"; supervisorId?: string | null; lines: OrderLineInput[]; notes?: string | null },
) {
  return db.$transaction(async (tx) => {
    const lines = await resolveLines(tx, args.companyId, args.lines);
    const code = await nextDailyCode(tx, "millingProductionOrder", args.companyId, "PO", new Date(args.productionDate));
    const order = await tx.millingProductionOrder.create({
      data: {
        companyId: args.companyId,
        code,
        productionDate: new Date(args.productionDate),
        shiftKind: args.shiftKind,
        supervisorId: args.supervisorId ?? null,
        notes: args.notes ?? null,
        createdById: args.userId,
        lines: { create: lines },
      },
      include: { lines: true },
    });
    await audit(tx, args.companyId, args.userId, order.id, "created", { code });
    return order;
  });
}

export async function submitOrder(db: PrismaClient, args: { companyId: string; userId: string; orderId: string }) {
  return db.$transaction(async (tx) => {
    const order = await orderOrThrow(tx, args.companyId, args.orderId);
    if (order.status !== "DRAFT") throw millRefusal(`${order.code} is ${order.status.toLowerCase()}.`);
    const needs = await requirementsFor(tx, args.companyId, order.lines.map((line) => ({ ...line, bags: line.bags })));
    const updated = await tx.millingProductionOrder.update({ where: { id: order.id }, data: { status: "SUBMITTED", maizeNeededKg: needs.maizeKg } });
    await audit(tx, args.companyId, args.userId, order.id, "submitted", { maizeKg: needs.maizeKg.toString(), short: needs.short });
    return updated;
  });
}

/**
 * Approve, and reserve the maize oldest lot first. Short: refused unless
 * `approveShort` with a reason, and then only what is free is reserved.
 */
export async function approveOrder(
  db: PrismaClient,
  args: { companyId: string; userId: string; orderId: string; approveShort?: boolean; reason?: string | null },
) {
  return db.$transaction(async (tx) => {
    const order = await orderOrThrow(tx, args.companyId, args.orderId);
    if (order.status !== "SUBMITTED") throw millRefusal(`Only a submitted order is approved; ${order.code} is ${order.status.toLowerCase()}.`);
    const needs = await requirementsFor(tx, args.companyId, order.lines);
    if (needs.short.length && !args.approveShort) throw millRefusal(`Short of ${needs.short.join(", ")}. Approve anyway with a reason, or change the plan.`);
    if (needs.short.length && (args.reason ?? "").trim().length < 3) throw millRefusal("Say why it is approved although materials are short.");

    const maize = await tx.product.findFirst({ where: { companyId: args.companyId, code: "MAIZE" }, select: { id: true } });
    let left = needs.maizeKg;
    if (maize) {
      const balances = await tx.millingLotBalance.findMany({
        where: { companyId: args.companyId, lot: { productId: maize.id, status: "AVAILABLE" } },
        include: { lot: { select: { producedAt: true } } },
      });
      balances.sort((a, b) => a.lot.producedAt.getTime() - b.lot.producedAt.getTime());
      for (const balance of balances) {
        if (left.lte(0)) break;
        const free = balance.quantity.minus(balance.reserved);
        if (free.lte(0)) continue;
        const take = Prisma.Decimal.min(free, left);
        await reserve(tx, { companyId: args.companyId, userId: args.userId, lotId: balance.lotId, stockLocationId: balance.stockLocationId, quantity: take, sourceType: ORDER_ENTITY, sourceId: order.id });
        left = left.minus(take);
      }
    }
    const updated = await tx.millingProductionOrder.update({
      where: { id: order.id },
      data: { status: "APPROVED", approvedById: args.userId, approvedAt: new Date(), approvedShort: needs.short.length > 0, maizeNeededKg: needs.maizeKg },
    });
    await audit(tx, args.companyId, args.userId, order.id, "approved", { short: needs.short, reservedKg: needs.maizeKg.minus(Prisma.Decimal.max(left, 0)).toString() }, args.reason ?? undefined);
    return updated;
  });
}

/** Send back, cancel or close an order; any maize still promised to it is released. */
export async function setOrderStatus(
  db: PrismaClient,
  args: { companyId: string; userId: string; orderId: string; status: "DRAFT" | "CANCELLED" | "CLOSED"; reason?: string | null },
) {
  return db.$transaction(async (tx) => {
    const order = await orderOrThrow(tx, args.companyId, args.orderId);
    const allowed: Record<string, string[]> = {
      DRAFT: ["SUBMITTED"],
      CANCELLED: ["DRAFT", "SUBMITTED", "APPROVED"],
      CLOSED: ["APPROVED", "IN_PROGRESS", "COMPLETED"],
    };
    if (!allowed[args.status].includes(order.status)) throw millRefusal(`${order.code} is ${order.status.toLowerCase()}; it cannot be ${args.status === "DRAFT" ? "sent back" : args.status.toLowerCase()}.`);
    await releaseOrderReservations(tx, args.companyId, order.id);
    const updated = await tx.millingProductionOrder.update({ where: { id: order.id }, data: { status: args.status } });
    await audit(tx, args.companyId, args.userId, order.id, args.status === "DRAFT" ? "sent-back" : args.status.toLowerCase(), undefined, args.reason ?? undefined);
    return updated;
  });
}

export async function releaseOrderReservations(tx: Tx, companyId: string, orderId: string) {
  const open = await tx.millingReservation.findMany({ where: { companyId, sourceType: ORDER_ENTITY, sourceId: orderId, status: "ACTIVE" } });
  for (const reservation of open) await releaseReservation(tx, { companyId, reservationId: reservation.id });
}
