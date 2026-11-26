import { Prisma, type PrismaClient } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";

import { assertNothingOwed, assertWithinLimit } from "../customers/credit";
import { millRefusal } from "../errors";
import { nextDailyCode } from "../records/codes";
import { millDay } from "../sellers/trips";
import { issueFromLot, receiveIntoLot } from "../stock/ledger";

/**
 * The mill's own till (Sell). Two ways to sell bags:
 *
 * - At the office: the bags come off the chosen store's released lots now,
 *   oldest first, for cash, EcoCash or on account to a customer (within their
 *   customer who owes nothing: one with an unpaid balance buys nothing until
 *   it is cleared). Books gets the sale as an invoice, with a receipt for the
 *   money, when someone with Books rights posts it.
 * - On the road: a seller sells from the bags on their open trip, for cash.
 *   Nothing moves yet; the bags are already out with them. When the trip is
 *   settled, what the till sold is what was sold, and the cash it took is
 *   what they hand in.
 *
 * Prices are the product's price. Only a seller on the road gives a
 * discount, within the mill's most a bag and its steps, as at settling.
 * A sale is voided, not changed: at the office the bags go back to the lots
 * they came from, on the road they go back to what the seller holds.
 */

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;
const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const ZERO = D(0);

export const SALE_ENTITY = "MillingSale";
export const SALE_PAYMENTS = ["CASH", "ECOCASH", "ON_ACCOUNT"] as const;
export type SalePayment = (typeof SALE_PAYMENTS)[number];

export interface SaleLineInput {
  productId: string;
  bags: number;
  /** On the road only: taken off each bag. */
  discountPerBag?: number;
}

async function audit(tx: Tx, companyId: string, actorId: string, id: string, action: string, payload?: Record<string, unknown>, reason?: string) {
  await writePlatformAuditEvent({ companyId, actorId, eventType: `milling.sale.${action}`, entityType: SALE_ENTITY, entityId: id, payload, reason }, tx);
}

/** The open trip of the seller this person is, if they are one and are out. */
export async function openTripOf(db: Db | Tx, companyId: string, userId: string) {
  const employee = await db.employee.findFirst({ where: { companyId, userId, isActive: true }, select: { id: true, name: true } });
  if (!employee) return null;
  const seller = await db.millingSeller.findFirst({ where: { companyId, employeeId: employee.id, isActive: true }, select: { id: true } });
  if (!seller) return null;
  const trip = await db.millingSellerTrip.findFirst({ where: { companyId, sellerId: seller.id, status: "OUT" }, include: { lines: true } });
  return trip ? { trip, seller: { id: seller.id, name: employee.name } } : null;
}

/** Bags of each product sold at the till on a trip so far, the discounts given, and the cash taken. */
export async function tripTillSales(db: Db | Tx, tripId: string) {
  const sales = await db.millingSale.findMany({ where: { tripId, status: "SOLD" }, include: { lines: true } });
  const bags = new Map<string, number>();
  const discounts: Array<{ productId: string; discount: number; bags: number }> = [];
  let cash = ZERO;
  for (const sale of sales) {
    cash = cash.plus(sale.totalAmount);
    for (const line of sale.lines) {
      bags.set(line.productId, (bags.get(line.productId) ?? 0) + line.bags);
      if (D(line.discountPerBag).gt(0)) {
        const discount = Number(line.discountPerBag);
        const same = discounts.find((row) => row.productId === line.productId && row.discount === discount);
        if (same) same.bags += line.bags;
        else discounts.push({ productId: line.productId, discount, bags: line.bags });
      }
    }
  }
  return { count: sales.length, bags, discounts, cash };
}

function checkLines(lines: SaleLineInput[]) {
  const wanted = new Map<string, { bags: number; discount: Prisma.Decimal }>();
  for (const line of lines) {
    if (!Number.isInteger(line.bags) || line.bags < 0) throw millRefusal("Enter the bags of each product as a whole number.");
    if (line.bags === 0) continue;
    const discount = D(line.discountPerBag ?? 0);
    const key = `${line.productId}|${discount.toFixed(2)}`;
    const entry = wanted.get(key) ?? { bags: 0, discount };
    entry.bags += line.bags;
    wanted.set(key, entry);
  }
  if (!wanted.size) throw millRefusal("Add the bags you are selling.");
  return [...wanted].map(([key, entry]) => ({ productId: key.split("|")[0]!, bags: entry.bags, discount: entry.discount }));
}

/**
 * Sell at the office: the bags come off the store's released lots now, oldest
 * first. On account needs a customer, and their limit must cover it.
 */
export async function sellAtOffice(
  db: Db,
  args: {
    companyId: string;
    userId: string;
    stockLocationId: string;
    lines: SaleLineInput[];
    payment: SalePayment;
    customerId?: string | null;
    customerName?: string | null;
    notes?: string | null;
    at?: Date;
  },
) {
  if (!SALE_PAYMENTS.includes(args.payment)) throw millRefusal("Say how the buyer paid.");
  const lines = checkLines(args.lines);
  if (lines.some((line) => line.discount.gt(0))) throw millRefusal("Bags are sold at their price at the office.");
  if (args.payment === "ON_ACCOUNT" && !args.customerId) throw millRefusal("Choose the customer the bags go on account to.");

  return db.$transaction(async (tx) => {
    const store = await tx.stockLocation.findFirst({ where: { id: args.stockLocationId, site: { companyId: args.companyId }, isActive: true }, select: { id: true, siteId: true, code: true, name: true } });
    if (!store || store.code === "WITH-SELLERS") throw millRefusal("Choose the store the bags come from.");
    const customer = args.customerId ? await tx.customer.findFirst({ where: { id: args.customerId, companyId: args.companyId }, select: { id: true, name: true } }) : null;
    if (args.customerId && !customer) throw millRefusal("That customer is not in this workspace.");

    const products = await tx.product.findMany({ where: { companyId: args.companyId, id: { in: lines.map((line) => line.productId) } }, select: { id: true, name: true, unit: true, standardPrice: true } });
    let gross = ZERO;
    for (const line of lines) {
      const product = products.find((entry) => entry.id === line.productId);
      if (!product) throw millRefusal("A line names a product that is not in this workspace.");
      if (product.unit !== "BAG") throw millRefusal(`${product.name} is not a packed product; the till sells bags.`);
      if (product.standardPrice.lte(0)) throw millRefusal(`Set a price on ${product.name} before it is sold.`);
      gross = gross.plus(product.standardPrice.times(line.bags));
    }

    // Grandmeal spec, Stage 2: a customer who owes anything takes no new sale until it is cleared, whatever they pay with.
    if (customer) await assertNothingOwed(tx, { companyId: args.companyId, customerId: customer.id, what: "sale" });
    if (args.payment === "ON_ACCOUNT") await assertWithinLimit(tx, { companyId: args.companyId, customerId: customer!.id, amount: gross });

    const code = await nextDailyCode(tx, "millingSale", args.companyId, "SL", args.at);
    const sale = await tx.millingSale.create({
      data: {
        companyId: args.companyId,
        code,
        source: "OFFICE",
        siteId: store.siteId,
        stockLocationId: store.id,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? (args.customerName?.trim() || null),
        payment: args.payment,
        grossAmount: gross,
        totalAmount: gross,
        soldById: args.userId,
        ...(args.at ? { soldAt: args.at } : {}),
        notes: args.notes?.trim() || null,
        lines: {
          create: lines.map((line) => {
            const price = products.find((entry) => entry.id === line.productId)!.standardPrice;
            return { productId: line.productId, bags: line.bags, unitPrice: price, amount: price.times(line.bags) };
          }),
        },
      },
      include: { lines: true },
    });

    // The bags, oldest released lot first, from this store only.
    const source = { companyId: args.companyId, userId: args.userId, sourceType: SALE_ENTITY, sourceId: sale.id, reference: code };
    for (const line of lines) {
      const product = products.find((entry) => entry.id === line.productId)!;
      const balances = await tx.millingLotBalance.findMany({ where: { companyId: args.companyId, stockLocationId: store.id, lot: { productId: line.productId, status: "AVAILABLE" } }, include: { lot: { select: { producedAt: true } } } });
      balances.sort((a, b) => a.lot.producedAt.getTime() - b.lot.producedAt.getTime());
      const free = balances.reduce((sum, row) => sum.plus(row.quantity).minus(row.reserved), ZERO);
      if (free.lt(line.bags)) throw millRefusal(`Only ${free.toString()} bags of ${product.name} are free in ${store.name}; ${line.bags} asked for.`);
      let left = D(line.bags);
      for (const balance of balances) {
        if (left.lte(0)) break;
        const take = Prisma.Decimal.min(balance.quantity.minus(balance.reserved), left);
        if (take.lte(0)) continue;
        await issueFromLot(tx, { ...source, lotId: balance.lotId, stockLocationId: store.id, quantity: take, reason: "GATE_SALE" });
        left = left.minus(take);
      }
    }
    await audit(tx, args.companyId, args.userId, sale.id, "sold", { code, source: "OFFICE", payment: args.payment, total: gross.toFixed(2) });
    return sale;
  });
}

/**
 * Sell on the road, from the bags on the seller's own open trip, for cash.
 * Only the seller sells from their trip, and never more than they took.
 */
export async function sellFromTrip(db: Db, args: { companyId: string; userId: string; lines: SaleLineInput[]; customerName?: string | null; notes?: string | null; at?: Date }) {
  const lines = checkLines(args.lines);
  return db.$transaction(async (tx) => {
    const mine = await openTripOf(tx, args.companyId, args.userId);
    if (!mine) throw millRefusal("You have no bags out. Ask stores to give you your bags, or sell at the office.");
    const { trip } = mine;
    // Serialise this trip's sales and its settling.
    await tx.$queryRaw`SELECT "id" FROM "MillingSellerTrip" WHERE "id" = ${trip.id} FOR UPDATE`;
    const still = await tx.millingSellerTrip.findUnique({ where: { id: trip.id }, select: { status: true } });
    if (still?.status !== "OUT") throw millRefusal(`${trip.code} is settled; its bags cannot be sold now.`);

    const settings = await tx.millingSettings.findUnique({ where: { companyId: args.companyId } });
    const max = D(settings?.sellerMaxDiscount ?? 1);
    const step = D(settings?.sellerDiscountStep ?? 0.1);
    const sold = (await tripTillSales(tx, trip.id)).bags;
    const products = await tx.product.findMany({ where: { id: { in: lines.map((line) => line.productId) } }, select: { id: true, name: true } });
    const name = (id: string) => products.find((product) => product.id === id)?.name ?? "that product";

    let gross = ZERO;
    let discountTotal = ZERO;
    const rows: Array<{ productId: string; bags: number; unitPrice: Prisma.Decimal; discountPerBag: Prisma.Decimal; amount: Prisma.Decimal }> = [];
    const asked = new Map<string, number>();
    for (const line of lines) {
      const out = trip.lines.filter((row) => row.productId === line.productId);
      if (!out.length) throw millRefusal(`You did not take ${name(line.productId)} on ${trip.code}.`);
      asked.set(line.productId, (asked.get(line.productId) ?? 0) + line.bags);
      const took = out.reduce((sum, row) => sum + row.bagsOut, 0);
      const left = took - (sold.get(line.productId) ?? 0);
      if ((asked.get(line.productId) ?? 0) > left) throw millRefusal(`You have ${left} ${left === 1 ? "bag" : "bags"} of ${name(line.productId)} left of the ${took} you took.`);
      if (line.discount.gt(max)) throw millRefusal(`You may take at most $${max.toFixed(2)} off a bag.`);
      if (line.discount.gt(0) && !line.discount.mod(step).isZero()) throw millRefusal(`Discounts go in steps of $${step.toFixed(2)}.`);
      const price = D(out[0]!.unitPrice);
      const amount = price.minus(line.discount).times(line.bags);
      gross = gross.plus(price.times(line.bags));
      discountTotal = discountTotal.plus(line.discount.times(line.bags));
      rows.push({ productId: line.productId, bags: line.bags, unitPrice: price, discountPerBag: line.discount, amount });
    }

    const code = await nextDailyCode(tx, "millingSale", args.companyId, "SL", args.at);
    const sale = await tx.millingSale.create({
      data: {
        companyId: args.companyId,
        code,
        source: "TRIP",
        siteId: trip.siteId,
        tripId: trip.id,
        customerName: args.customerName?.trim() || null,
        payment: "CASH",
        grossAmount: gross,
        discountAmount: discountTotal,
        totalAmount: gross.minus(discountTotal),
        soldById: args.userId,
        ...(args.at ? { soldAt: args.at } : {}),
        notes: args.notes?.trim() || null,
        lines: { create: rows },
      },
      include: { lines: true },
    });
    await audit(tx, args.companyId, args.userId, sale.id, "sold", { code, source: "TRIP", trip: trip.code, total: sale.totalAmount.toFixed(2) });
    return sale;
  });
}

/**
 * Void a sale: at the office the bags go back to the lots and store they came
 * from; on the road they are the seller's to sell again. Not once Books has
 * it, nor once the trip it was sold on is settled. The seller or management
 * voids, the same day, with a reason.
 */
export async function voidSale(db: Db, args: { companyId: string; userId: string; saleId: string; reason: string; mayVoidAny: boolean; at?: Date }) {
  const reason = args.reason.trim();
  if (reason.length < 3) throw millRefusal("Say why the sale is voided.");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "MillingSale" WHERE "id" = ${args.saleId} FOR UPDATE`;
    const sale = await tx.millingSale.findFirst({ where: { id: args.saleId, companyId: args.companyId }, include: { trip: { select: { status: true, code: true } } } });
    if (!sale) throw millRefusal("That sale is not in this workspace.");
    if (sale.status !== "SOLD") throw millRefusal(`${sale.code} is voided already.`);
    if (sale.soldById !== args.userId && !args.mayVoidAny) throw millRefusal("Only whoever sold it, or management, voids a sale.");
    if (sale.postedAt || sale.invoiceId) throw millRefusal(`${sale.code} is in Books. Credit it there.`);
    if (sale.trip && sale.trip.status !== "OUT") throw millRefusal(`${sale.trip.code} is settled with this sale in it.`);
    if (millDay(sale.soldAt).getTime() !== millDay(args.at).getTime() && !args.mayVoidAny) throw millRefusal("Only management voids a sale from an earlier day.");

    if (sale.source === "OFFICE") {
      const issued = await tx.millingLotMovement.findMany({ where: { companyId: args.companyId, sourceType: SALE_ENTITY, sourceId: sale.id, reason: "GATE_SALE" } });
      const source = { companyId: args.companyId, userId: args.userId, sourceType: SALE_ENTITY, sourceId: sale.id, reference: sale.code };
      for (const movement of issued) {
        if (!movement.fromLocationId) continue;
        await receiveIntoLot(tx, { ...source, lotId: movement.lotId, stockLocationId: movement.fromLocationId, quantity: movement.quantity, reason: "SALE_VOID" });
      }
    }
    const voided = await tx.millingSale.update({ where: { id: sale.id }, data: { status: "VOIDED", voidedById: args.userId, voidedAt: new Date(), voidReason: reason } });
    await audit(tx, args.companyId, args.userId, sale.id, "voided", { code: sale.code }, reason);
    return voided;
  });
}
