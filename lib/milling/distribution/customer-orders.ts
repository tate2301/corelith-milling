import { Prisma, type PrismaClient } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";

import { millAccessFor, can, type MillCapability } from "../access/groups";
import { assertNothingOwed } from "../customers/credit";
import { useVoucher } from "../customers/vouchers";
import { millRefusal } from "../errors";
import { nextDailyCode } from "../records/codes";
import { releaseReservation } from "../stock/ledger";

/**
 * Customer orders (Grandmeal spec, Stage 2). Marketing logs the orders it
 * wins; the accountant assigns each to a sales rep; the rep confirms it with
 * the customer and moves it to Ongoing, puts it on a trip, and marks it
 * Complete when the bags are handed over; accounting closes it once the money
 * is in.
 *
 *   PENDING   logged, not yet worked          the system, when marketing logs it
 *   ONGOING   confirmed; scheduled or on a truck   the sales rep
 *   COMPLETE  bags handed over                 the sales rep (on delivery)
 *   CLOSED    money received and confirmed     accounting only
 *   CANCELLED will not go ahead; reason given  the sales rep or accounting
 *
 * A customer who owes anything cannot be given a new order. Lines are in bags,
 * or in tonnes converted with the bag's net weight (1 t = 1000 / net kg bags).
 * Bags are kept for the order when it is loaded on a trip, not before.
 */

type Tx = Prisma.TransactionClient;
type Db = PrismaClient;
export const CUSTOMER_ORDER_ENTITY = "MillingCustomerOrder";
const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

export const ORDER_STATES = ["PENDING", "ONGOING", "COMPLETE", "CLOSED", "CANCELLED"] as const;
export type OrderState = (typeof ORDER_STATES)[number];
export const ORDER_STATE_WORDS: Record<OrderState, string> = {
  PENDING: "Pending",
  ONGOING: "Ongoing",
  COMPLETE: "Complete",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

/** Who is acting, with their mill rights; the services check rights themselves, not only the routes. */
export interface OrderActor {
  companyId: string;
  userId: string;
  role: string;
  groups: readonly string[];
}

function rights(actor: OrderActor) {
  const access = millAccessFor(actor.role, actor.groups);
  return (capability: MillCapability) => can(access, capability);
}

async function orderOrThrow(tx: Tx, companyId: string, orderId: string) {
  await tx.$queryRaw`SELECT "id" FROM "MillingCustomerOrder" WHERE "id" = ${orderId} FOR UPDATE`;
  const order = await tx.millingCustomerOrder.findFirst({ where: { id: orderId, companyId }, include: { lines: true } });
  if (!order) throw millRefusal("That order is not in this workspace.");
  return order;
}

async function audit(tx: Tx, companyId: string, actorId: string, id: string, action: string, payload?: Record<string, unknown>, reason?: string) {
  await writePlatformAuditEvent({ companyId, actorId, eventType: `milling.customer-order.${action}`, entityType: CUSTOMER_ORDER_ENTITY, entityId: id, payload, reason }, tx);
}

/** Bags in `tonnes` of a bag of `netKg`: whole bags only (1 t is 200 bags of 5 kg, 20 of 50 kg). */
export function bagsInTonnes(tonnes: Prisma.Decimal.Value, netKg: Prisma.Decimal.Value): number | null {
  const net = D(netKg);
  if (net.lte(0)) return null;
  const bags = D(tonnes).times(1000).dividedBy(net);
  return bags.isInteger() && bags.gt(0) ? bags.toNumber() : null;
}

export type OrderLineInput = { productId: string; bags?: number | null; tonnes?: number | null; unitPrice?: number | null };

/** Marketing logs an order: an existing customer or a new one, products in bags or tonnes, and the date wanted. */
export async function logCustomerOrder(
  db: Db,
  args: {
    actor: OrderActor;
    customerId?: string | null;
    newCustomer?: { name: string; phone?: string | null } | null;
    destinationId?: string | null;
    requiredDate?: string | null;
    notes?: string | null;
    lines: OrderLineInput[];
  },
) {
  const { actor } = args;
  if (!rights(actor)("order.log")) throw millRefusal("Only marketing logs orders.");
  if (!args.lines.length) throw millRefusal("Add at least one product.");
  if (!args.customerId && !args.newCustomer?.name?.trim()) throw millRefusal("Choose the customer, or add a new one.");
  return db.$transaction(async (tx) => {
    let customerId = args.customerId ?? null;
    if (customerId) {
      const customer = await tx.customer.findFirst({ where: { id: customerId, companyId: actor.companyId }, select: { id: true } });
      if (!customer) throw millRefusal("That customer is not in this workspace.");
      await assertNothingOwed(tx, { companyId: actor.companyId, customerId, what: "order" });
    } else {
      const created = await tx.customer.create({
        data: { companyId: actor.companyId, name: args.newCustomer!.name.trim(), phone: args.newCustomer!.phone?.trim() || null },
        select: { id: true, name: true },
      });
      customerId = created.id;
      await writePlatformAuditEvent({ companyId: actor.companyId, actorId: actor.userId, eventType: "milling.customer.added", entityType: "Customer", entityId: created.id, payload: { name: created.name, by: "marketing" } }, tx);
    }
    if (args.destinationId && !(await tx.millingDestination.findFirst({ where: { id: args.destinationId, companyId: actor.companyId } }))) {
      throw millRefusal("That destination is not one of the mill's.");
    }
    const products = await tx.product.findMany({
      where: { companyId: actor.companyId, id: { in: args.lines.map((line) => line.productId) } },
      select: { id: true, name: true, unit: true, netWeightKg: true },
    });
    const lines = args.lines.map((line) => {
      const product = products.find((entry) => entry.id === line.productId);
      if (!product) throw millRefusal("A line names a product that is not in this workspace.");
      if (product.unit !== "BAG") throw millRefusal(`${product.name} is not a packed product; orders are for bags.`);
      if (line.tonnes !== null && line.tonnes !== undefined) {
        if (!product.netWeightKg) throw millRefusal(`Set the net weight of ${product.name} before it is ordered in tonnes.`);
        const bags = bagsInTonnes(line.tonnes, product.netWeightKg);
        if (bags === null) throw millRefusal(`${line.tonnes} t of ${product.name} is not a whole number of bags.`);
        return { productId: product.id, bags, enteredTonnes: D(line.tonnes), unitPrice: line.unitPrice ?? null };
      }
      if (!Number.isInteger(line.bags) || (line.bags ?? 0) <= 0) throw millRefusal(`Enter the bags or tonnes of ${product.name}.`);
      return { productId: product.id, bags: line.bags!, enteredTonnes: null, unitPrice: line.unitPrice ?? null };
    });
    const code = await nextDailyCode(tx, "millingCustomerOrder", actor.companyId, "CO");
    const order = await tx.millingCustomerOrder.create({
      data: {
        companyId: actor.companyId,
        code,
        customerId: customerId!,
        destinationId: args.destinationId ?? null,
        requiredDate: args.requiredDate ? new Date(args.requiredDate) : null,
        notes: args.notes ?? null,
        status: "PENDING",
        marketingAgentId: actor.userId,
        createdById: actor.userId,
        lines: { create: lines },
      },
      include: { lines: true },
    });
    await audit(tx, actor.companyId, actor.userId, order.id, "logged", { code, customerId, lines: lines.map((line) => ({ productId: line.productId, bags: line.bags, tonnes: line.enteredTonnes?.toString() ?? null })) });
    return order;
  });
}

/** The accountant assigns an order to a sales rep: someone in the Sales rep group. */
export async function assignOrderRep(db: Db, args: { actor: OrderActor; orderId: string; salesRepId: string }) {
  const { actor } = args;
  if (!rights(actor)("order.assign")) throw millRefusal("Only the accountant assigns orders to reps.");
  return db.$transaction(async (tx) => {
    const order = await orderOrThrow(tx, actor.companyId, args.orderId);
    if (!["PENDING", "ONGOING"].includes(order.status)) throw millRefusal(`${order.code} is ${order.status.toLowerCase()}; it is not reassigned.`);
    const rep = await tx.millingGroupMember.findFirst({ where: { companyId: actor.companyId, userId: args.salesRepId, groupCode: "SALES_REP" } });
    if (!rep) throw millRefusal("Choose someone in the Sales rep group.");
    const updated = await tx.millingCustomerOrder.update({ where: { id: order.id }, data: { salesRepId: args.salesRepId, assignedById: actor.userId, assignedAt: new Date() } });
    await audit(tx, actor.companyId, actor.userId, order.id, "assigned", { from: order.salesRepId, to: args.salesRepId });
    return updated;
  });
}

/** May this person work this order as its rep? Its assigned rep, or accounting. */
function worksOrder(actor: OrderActor, order: { salesRepId: string | null }) {
  const has = rights(actor);
  return has("order.assign") || (has("order.work") && order.salesRepId === actor.userId);
}

/** The rep confirms the order with the customer: Pending → Ongoing. */
export async function markOrderOngoing(db: Db, args: { actor: OrderActor; orderId: string }) {
  const { actor } = args;
  return db.$transaction(async (tx) => {
    const order = await orderOrThrow(tx, actor.companyId, args.orderId);
    if (!order.salesRepId) throw millRefusal(`${order.code} has no sales rep yet; the accountant assigns one first.`);
    if (!worksOrder(actor, order)) throw millRefusal(`${order.code} is another rep's order.`);
    if (order.status !== "PENDING") throw millRefusal(`${order.code} is ${order.status.toLowerCase()}.`);
    const updated = await tx.millingCustomerOrder.update({ where: { id: order.id }, data: { status: "ONGOING", ongoingAt: new Date() } });
    await audit(tx, actor.companyId, actor.userId, order.id, "ongoing", { from: "PENDING", to: "ONGOING" });
    return updated;
  });
}

/** Will not go ahead: by its rep or accounting, before the bags are handed over. Bags kept for it go back. */
export async function cancelCustomerOrder(db: Db, args: { actor: OrderActor; orderId: string; reason: string }) {
  const { actor } = args;
  if (args.reason.trim().length < 3) throw millRefusal("Say why the order is cancelled.");
  return db.$transaction(async (tx) => {
    const order = await orderOrThrow(tx, actor.companyId, args.orderId);
    if (!worksOrder(actor, order)) throw millRefusal(order.salesRepId ? `${order.code} is another rep's order.` : "Only its rep or accounting cancels an order.");
    if (!["PENDING", "ONGOING"].includes(order.status)) throw millRefusal(`${order.code} is ${order.status.toLowerCase()}; it cannot be cancelled.`);
    const onTruck = await tx.millingDeliveryLine.findFirst({ where: { orderId: order.id, delivery: { status: { notIn: ["PLANNED", "LOADING", "CANCELLED"] } } }, select: { id: true } });
    if (onTruck) throw millRefusal(`${order.code} is out on a truck; record what was delivered instead.`);
    await tx.millingDeliveryLine.deleteMany({ where: { orderId: order.id } });
    const open = await tx.millingReservation.findMany({
      where: { companyId: actor.companyId, sourceType: "MillingCustomerOrderLine", sourceId: { in: order.lines.map((line) => line.id) }, status: "ACTIVE" },
    });
    for (const reservation of open) await releaseReservation(tx, { companyId: actor.companyId, reservationId: reservation.id });
    const updated = await tx.millingCustomerOrder.update({
      where: { id: order.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: args.reason.trim() },
    });
    await audit(tx, actor.companyId, actor.userId, order.id, "cancelled", { from: order.status, to: "CANCELLED" }, args.reason);
    return updated;
  });
}

/** The rep applies the customer's voucher to one line of the order, before it is handed over. */
export async function applyOrderVoucher(db: Db, args: { actor: OrderActor; orderId: string; orderLineId: string; voucherId: string }) {
  const { actor } = args;
  return db.$transaction(async (tx) => {
    const order = await orderOrThrow(tx, actor.companyId, args.orderId);
    if (!worksOrder(actor, order)) throw millRefusal(`${order.code} is another rep's order.`);
    if (!["PENDING", "ONGOING"].includes(order.status)) throw millRefusal(`${order.code} is ${order.status.toLowerCase()}; its prices are settled.`);
    const line = order.lines.find((entry) => entry.id === args.orderLineId);
    if (!line) throw millRefusal("That line is not on this order.");
    if (line.voucherId) throw millRefusal("That line already has a voucher.");
    const product = await tx.product.findUniqueOrThrow({ where: { id: line.productId }, select: { standardPrice: true, name: true } });
    const unitPrice = line.unitPrice ?? product.standardPrice;
    if (D(unitPrice).lte(0)) throw millRefusal(`Set a price on ${product.name} before a voucher comes off it.`);
    const discount = await useVoucher(tx, { companyId: actor.companyId, userId: actor.userId, voucherId: args.voucherId, customerId: order.customerId, bags: line.bags, unitPrice, orderLineId: line.id });
    const updated = await tx.millingCustomerOrderLine.update({ where: { id: line.id }, data: { voucherId: args.voucherId, discount, unitPrice } });
    await audit(tx, actor.companyId, actor.userId, order.id, "voucher-applied", { line: line.id, voucherId: args.voucherId, discount: discount.toString() });
    return updated;
  });
}

/** Which orders this person may see: accounting and the manager all; a rep theirs; marketing what it logged. */
export function orderScope(actor: OrderActor): Prisma.MillingCustomerOrderWhereInput {
  const has = rights(actor);
  if (has("order.assign") || has("money.view") || has("delivery.manage")) return {};
  const mine: Prisma.MillingCustomerOrderWhereInput[] = [];
  if (has("order.work")) mine.push({ salesRepId: actor.userId });
  if (has("order.log")) mine.push({ marketingAgentId: actor.userId });
  return mine.length ? { OR: mine } : { id: "__none__" };
}
