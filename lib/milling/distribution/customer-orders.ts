import { Prisma, type PrismaClient } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";

import { millRefusal } from "../errors";
import { nextDailyCode } from "../records/codes";
import { releaseReservation, reserve } from "../stock/ledger";

/**
 * Customer orders (plan 4.11). Confirming an order reserves packed bags,
 * oldest lot first, so a later order cannot take them. Cancelling releases
 * whatever is still promised.
 */

type Tx = Prisma.TransactionClient;
export const CUSTOMER_ORDER_ENTITY = "MillingCustomerOrder";

async function orderOrThrow(tx: Tx, companyId: string, orderId: string) {
  await tx.$queryRaw`SELECT "id" FROM "MillingCustomerOrder" WHERE "id" = ${orderId} FOR UPDATE`;
  const order = await tx.millingCustomerOrder.findFirst({ where: { id: orderId, companyId }, include: { lines: true } });
  if (!order) throw millRefusal("That order is not in this workspace.");
  return order;
}

async function audit(tx: Tx, companyId: string, actorId: string, id: string, action: string, payload?: Record<string, unknown>, reason?: string) {
  await writePlatformAuditEvent({ companyId, actorId, eventType: `milling.customer-order.${action}`, entityType: CUSTOMER_ORDER_ENTITY, entityId: id, payload, reason }, tx);
}

export async function createCustomerOrder(
  db: PrismaClient,
  args: {
    companyId: string;
    userId: string;
    customerId: string;
    destinationId?: string | null;
    requiredDate?: string | null;
    notes?: string | null;
    lines: Array<{ productId: string; bags: number; unitPrice?: number | null }>;
  },
) {
  if (!args.lines.length) throw millRefusal("Add at least one product.");
  return db.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id: args.customerId, companyId: args.companyId }, select: { id: true } });
    if (!customer) throw millRefusal("That customer is not in this workspace.");
    if (args.destinationId && !(await tx.millingDestination.findFirst({ where: { id: args.destinationId, companyId: args.companyId } }))) throw millRefusal("That destination is not one of the mill's.");
    const products = await tx.product.findMany({ where: { companyId: args.companyId, id: { in: args.lines.map((line) => line.productId) } }, select: { id: true, name: true, unit: true } });
    for (const line of args.lines) {
      const product = products.find((entry) => entry.id === line.productId);
      if (!product) throw millRefusal("A line names a product that is not in this workspace.");
      if (product.unit !== "BAG") throw millRefusal(`${product.name} is not a packed product; orders are for bags.`);
      if (!Number.isInteger(line.bags) || line.bags <= 0) throw millRefusal(`Enter the bags of ${product.name}.`);
    }
    const code = await nextDailyCode(tx, "millingCustomerOrder", args.companyId, "CO");
    const order = await tx.millingCustomerOrder.create({
      data: {
        companyId: args.companyId,
        code,
        customerId: args.customerId,
        destinationId: args.destinationId ?? null,
        requiredDate: args.requiredDate ? new Date(args.requiredDate) : null,
        notes: args.notes ?? null,
        createdById: args.userId,
        lines: { create: args.lines.map((line) => ({ productId: line.productId, bags: line.bags, unitPrice: line.unitPrice ?? null })) },
      },
      include: { lines: true },
    });
    await audit(tx, args.companyId, args.userId, order.id, "created", { code });
    return order;
  });
}

/** Confirm: check every line can be met from released stock, then reserve it, oldest lot first. */
export async function confirmCustomerOrder(db: PrismaClient, args: { companyId: string; userId: string; orderId: string }) {
  return db.$transaction(async (tx) => {
    const order = await orderOrThrow(tx, args.companyId, args.orderId);
    if (order.status !== "DRAFT") throw millRefusal(`${order.code} is ${order.status.toLowerCase()}.`);
    for (const line of order.lines) {
      const balances = await tx.millingLotBalance.findMany({
        where: { companyId: args.companyId, lot: { productId: line.productId, status: "AVAILABLE" } },
        include: { lot: { select: { producedAt: true } } },
      });
      balances.sort((a, b) => a.lot.producedAt.getTime() - b.lot.producedAt.getTime());
      const free = balances.reduce((sum, row) => sum.plus(row.quantity).minus(row.reserved), new Prisma.Decimal(0));
      if (free.lt(line.bags)) {
        const product = await tx.product.findUniqueOrThrow({ where: { id: line.productId }, select: { name: true } });
        throw millRefusal(`Only ${free.toString()} bags of ${product.name} are free; the order needs ${line.bags}.`);
      }
      let left = new Prisma.Decimal(line.bags);
      for (const balance of balances) {
        if (left.lte(0)) break;
        const take = Prisma.Decimal.min(balance.quantity.minus(balance.reserved), left);
        if (take.lte(0)) continue;
        await reserve(tx, { companyId: args.companyId, userId: args.userId, lotId: balance.lotId, stockLocationId: balance.stockLocationId, quantity: take, sourceType: "MillingCustomerOrderLine", sourceId: line.id });
        left = left.minus(take);
      }
    }
    const updated = await tx.millingCustomerOrder.update({ where: { id: order.id }, data: { status: "CONFIRMED" } });
    await audit(tx, args.companyId, args.userId, order.id, "confirmed");
    return updated;
  });
}

export async function cancelCustomerOrder(db: PrismaClient, args: { companyId: string; userId: string; orderId: string; reason: string }) {
  if (args.reason.trim().length < 3) throw millRefusal("Say why the order is cancelled.");
  return db.$transaction(async (tx) => {
    const order = await orderOrThrow(tx, args.companyId, args.orderId);
    if (!["DRAFT", "CONFIRMED"].includes(order.status)) throw millRefusal(`${order.code} is ${order.status.toLowerCase().replace(/_/g, " ")}; it cannot be cancelled.`);
    const open = await tx.millingReservation.findMany({
      where: { companyId: args.companyId, sourceType: "MillingCustomerOrderLine", sourceId: { in: order.lines.map((line) => line.id) }, status: "ACTIVE" },
    });
    for (const reservation of open) await releaseReservation(tx, { companyId: args.companyId, reservationId: reservation.id });
    const updated = await tx.millingCustomerOrder.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
    await audit(tx, args.companyId, args.userId, order.id, "cancelled", undefined, args.reason);
    return updated;
  });
}
