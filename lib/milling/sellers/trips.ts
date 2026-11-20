import { Prisma, type PrismaClient } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";

import { millRefusal } from "../errors";
import { millDayStamp, nextDailyCode } from "../records/codes";
import { issueFromLot, moveLot, releaseReservation, reserve } from "../stock/ledger";

/**
 * Seller trips. A seller is one of the mill's employees who takes packed bags
 * from a store, sells them, and comes back the same day to account for them:
 * the bags they did not sell go back to the store, and they hand in the money
 * for the rest.
 *
 * The rules (the client, 20 Nov 2026):
 * - One trip a seller a day, from one site's store.
 * - The seller owes the full price of every bag sold, less the discounts they
 *   gave: at most the mill's most a bag ($1), in its steps (10c).
 * - The mill pays them commission on what they sold, per bag, a share, or both.
 * - Money owed and not handed in is a shortage. A seller with a shortage
 *   cannot take bags again until it is paid, unless a manager overrides with
 *   a reason.
 *
 * While the seller is out, their bags sit in the site's "With sellers" place,
 * reserved for the trip: still the mill's stock, but nothing else (an order,
 * the gate till, a pack run) can take them. Settling releases them: bags back
 * move to the store they came from, bags sold leave stock as SELLER_SALE.
 *
 * Nobody issues or settles their own trip.
 */

type Tx = Prisma.TransactionClient;
type Db = PrismaClient;
const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const ZERO = D(0);

export const SELLER_TRIP_ENTITY = "MillingSellerTrip";
const WITH_SELLERS_CODE = "WITH-SELLERS";

/** The mill's day as a date (Harare), the same day its codes carry. */
export function millDay(at: Date = new Date()): Date {
  const stamp = millDayStamp(at);
  return new Date(`20${stamp.slice(0, 2)}-${stamp.slice(2, 4)}-${stamp.slice(4, 6)}T00:00:00.000Z`);
}

async function audit(tx: Tx, companyId: string, actorId: string, id: string, action: string, payload?: Record<string, unknown>, reason?: string) {
  await writePlatformAuditEvent(
    { companyId, actorId, eventType: `milling.seller-trip.${action}`, entityType: SELLER_TRIP_ENTITY, entityId: id, payload, reason },
    tx,
  );
}

/** What a seller owes the mill now: every settled trip's amount due, less everything they handed in. */
export async function sellerBalance(tx: Tx | Db, companyId: string, sellerId: string): Promise<Prisma.Decimal> {
  const [due, paid] = await Promise.all([
    tx.millingSellerTrip.aggregate({ where: { companyId, sellerId, status: "SETTLED" }, _sum: { amountDue: true } }),
    tx.millingSellerPayment.aggregate({ where: { companyId, sellerId }, _sum: { amount: true } }),
  ]);
  return (due._sum.amountDue ?? ZERO).minus(paid._sum.amount ?? ZERO);
}

async function sellerOrThrow(tx: Tx, companyId: string, sellerId: string) {
  const seller = await tx.millingSeller.findFirst({ where: { id: sellerId, companyId } });
  if (!seller) throw millRefusal("That seller is not one of the mill's.");
  const employee = await tx.employee.findFirst({
    where: { id: seller.employeeId, companyId },
    select: { id: true, name: true, userId: true, isActive: true },
  });
  if (!employee) throw millRefusal("That seller's employee record is missing.");
  return { seller, employee };
}

/** Make an employee a seller (or bring them back). */
export async function addSeller(db: Db, args: { companyId: string; userId: string; employeeId: string }) {
  return db.$transaction(async (tx) => {
    const employee = await tx.employee.findFirst({ where: { id: args.employeeId, companyId: args.companyId }, select: { id: true, name: true, isActive: true } });
    if (!employee) throw millRefusal("That employee is not in this workspace.");
    if (!employee.isActive) throw millRefusal(`${employee.name} is no longer employed here.`);
    return tx.millingSeller.upsert({
      where: { companyId_employeeId: { companyId: args.companyId, employeeId: employee.id } },
      update: { isActive: true },
      create: { companyId: args.companyId, employeeId: employee.id, createdById: args.userId },
    });
  });
}

/** Stop someone selling. Refused while they are out or still owe money: both have to be settled first. */
export async function retireSeller(db: Db, args: { companyId: string; userId: string; sellerId: string }) {
  return db.$transaction(async (tx) => {
    const { seller, employee } = await sellerOrThrow(tx, args.companyId, args.sellerId);
    const out = await tx.millingSellerTrip.findFirst({ where: { companyId: args.companyId, sellerId: seller.id, status: "OUT" }, select: { code: true } });
    if (out) throw millRefusal(`${employee.name} is still out on ${out.code}. Settle it first.`);
    const owed = await sellerBalance(tx, args.companyId, seller.id);
    if (owed.gt(0)) throw millRefusal(`${employee.name} still owes $${owed.toFixed(2)}.`);
    return tx.millingSeller.update({ where: { id: seller.id }, data: { isActive: false } });
  });
}

/** The site's place for bags out with sellers, made the first time a seller goes out from it. */
async function withSellersPlace(tx: Tx, companyId: string, siteId: string) {
  const existing = await tx.stockLocation.findFirst({ where: { siteId, code: WITH_SELLERS_CODE }, select: { id: true } });
  const place =
    existing ??
    (await tx.stockLocation.create({
      data: { siteId, code: WITH_SELLERS_CODE, name: "With sellers", sortOrder: 9999 },
      select: { id: true },
    }));
  await tx.millingLocationProfile.upsert({
    where: { stockLocationId: place.id },
    update: {},
    create: { companyId, stockLocationId: place.id, kind: "SELLERS" },
  });
  return place.id;
}

export interface IssueLine {
  productId: string;
  bags: number;
}

/**
 * Bags out to a seller. Takes each product's bags from the store's released
 * lots, oldest first, and keeps them for the trip.
 */
export async function issueSellerTrip(
  db: Db,
  args: {
    companyId: string;
    userId: string;
    sellerId: string;
    fromLocationId: string;
    lines: IssueLine[];
    /** Whether the person may let a seller who owes money go out (a manager). */
    mayOverride: boolean;
    overrideReason?: string | null;
    notes?: string | null;
    at?: Date;
  },
) {
  const wanted = new Map<string, number>();
  for (const line of args.lines) {
    if (!Number.isInteger(line.bags) || line.bags <= 0) throw millRefusal("Enter the bags of each product as a whole number.");
    wanted.set(line.productId, (wanted.get(line.productId) ?? 0) + line.bags);
  }
  if (!wanted.size) throw millRefusal("Add at least one product.");
  const tripDate = millDay(args.at);

  return db.$transaction(async (tx) => {
    const { seller, employee } = await sellerOrThrow(tx, args.companyId, args.sellerId);
    // Serialise this seller's trips: two clerks issuing at once cannot both get past the checks.
    await tx.$queryRaw`SELECT "id" FROM "MillingSeller" WHERE "id" = ${seller.id} FOR UPDATE`;
    if (!seller.isActive || !employee.isActive) throw millRefusal(`${employee.name} is not selling for the mill now.`);
    if (employee.userId && employee.userId === args.userId) throw millRefusal("Someone else has to give you your bags.");

    const open = await tx.millingSellerTrip.findFirst({ where: { companyId: args.companyId, sellerId: seller.id, status: "OUT" }, select: { code: true } });
    if (open) throw millRefusal(`${employee.name} is still out on ${open.code}. Settle it before they take more.`);
    const today = await tx.millingSellerTrip.findFirst({
      where: { companyId: args.companyId, sellerId: seller.id, tripDate, status: { not: "CANCELLED" } },
      select: { code: true },
    });
    if (today) throw millRefusal(`${employee.name} has been out today already (${today.code}). One trip a day.`);

    const owed = await sellerBalance(tx, args.companyId, seller.id);
    const reason = args.overrideReason?.trim() || null;
    if (owed.gt(0)) {
      if (!args.mayOverride) throw millRefusal(`${employee.name} owes $${owed.toFixed(2)} from an earlier trip. It must be paid before they take bags again.`);
      if (!reason) throw millRefusal(`${employee.name} owes $${owed.toFixed(2)}. Give a reason to let them go out anyway.`);
    }

    const from = await tx.stockLocation.findFirst({
      where: { id: args.fromLocationId, site: { companyId: args.companyId }, isActive: true },
      select: { id: true, siteId: true, code: true, name: true },
    });
    if (!from || from.code === WITH_SELLERS_CODE) throw millRefusal("Choose the store the bags come from.");
    const toPlace = await withSellersPlace(tx, args.companyId, from.siteId);

    const products = await tx.product.findMany({
      where: { companyId: args.companyId, id: { in: [...wanted.keys()] } },
      select: { id: true, name: true, unit: true, standardPrice: true },
    });
    const rates = await tx.millingSellerRate.findMany({ where: { companyId: args.companyId, productId: { in: [...wanted.keys()] } } });
    for (const productId of wanted.keys()) {
      const product = products.find((entry) => entry.id === productId);
      if (!product) throw millRefusal("A line names a product that is not in this workspace.");
      if (product.unit !== "BAG") throw millRefusal(`${product.name} is not a packed product; sellers take bags.`);
      if (product.standardPrice.lte(0)) throw millRefusal(`Set a price on ${product.name} before a seller takes it.`);
    }

    const code = await nextDailyCode(tx, "millingSellerTrip", args.companyId, "ST", args.at);
    const trip = await tx.millingSellerTrip.create({
      data: {
        companyId: args.companyId,
        code,
        sellerId: seller.id,
        tripDate,
        siteId: from.siteId,
        fromLocationId: from.id,
        withSellersLocationId: toPlace,
        issuedById: args.userId,
        owedAtIssue: owed,
        overrideById: owed.gt(0) ? args.userId : null,
        overrideReason: owed.gt(0) ? reason : null,
        notes: args.notes?.trim() || null,
      },
    });

    const source = { companyId: args.companyId, userId: args.userId, sourceType: SELLER_TRIP_ENTITY, sourceId: trip.id, reference: code };
    for (const [productId, bags] of wanted) {
      const product = products.find((entry) => entry.id === productId)!;
      const rate = rates.find((entry) => entry.productId === productId);
      const balances = await tx.millingLotBalance.findMany({
        where: { companyId: args.companyId, stockLocationId: from.id, lot: { productId, status: "AVAILABLE" } },
        include: { lot: { select: { producedAt: true } } },
      });
      balances.sort((a, b) => a.lot.producedAt.getTime() - b.lot.producedAt.getTime());
      const free = balances.reduce((sum, row) => sum.plus(row.quantity).minus(row.reserved), ZERO);
      if (free.lt(bags)) throw millRefusal(`Only ${free.toString()} bags of ${product.name} are free in ${from.name}; ${bags} asked for.`);
      let left = D(bags);
      for (const balance of balances) {
        if (left.lte(0)) break;
        const take = Prisma.Decimal.min(balance.quantity.minus(balance.reserved), left);
        if (take.lte(0)) continue;
        await moveLot(tx, { ...source, lotId: balance.lotId, fromLocationId: from.id, toLocationId: toPlace, quantity: take });
        const held = await reserve(tx, { companyId: args.companyId, userId: args.userId, lotId: balance.lotId, stockLocationId: toPlace, quantity: take, sourceType: SELLER_TRIP_ENTITY, sourceId: trip.id });
        await tx.millingSellerTripLine.create({
          data: {
            tripId: trip.id,
            productId,
            lotId: balance.lotId,
            reservationId: held.id,
            bagsOut: take.toNumber(),
            unitPrice: product.standardPrice,
            commissionPerBag: rate?.commissionPerBag ?? ZERO,
            commissionPct: rate?.commissionPct ?? ZERO,
          },
        });
        left = left.minus(take);
      }
    }

    await audit(tx, args.companyId, args.userId, trip.id, "issued", { code, seller: employee.name, bags: [...wanted.values()].reduce((a, b) => a + b, 0) }, owed.gt(0) ? reason ?? undefined : undefined);
    if (owed.gt(0)) await audit(tx, args.companyId, args.userId, trip.id, "override", { owed: owed.toFixed(2) }, reason ?? undefined);
    return tx.millingSellerTrip.findUniqueOrThrow({ where: { id: trip.id }, include: { lines: true } });
  });
}

export interface SettleInput {
  /** Bags of each product the seller brought back. Products left out came back with none. */
  returned: Array<{ productId: string; bags: number }>;
  /** Bags sold below price: how much off a bag and how many bags. */
  discounts: Array<{ productId: string; discount: number; bags: number }>;
  cashReceived: number;
  notes?: string | null;
}

/** The sums of a settlement, before anything is written. Pure: the screen shows the same figures as it is typed. */
export function settlementFigures(
  lines: ReadonlyArray<{ productId: string; bagsOut: number; unitPrice: Prisma.Decimal.Value; commissionPerBag: Prisma.Decimal.Value; commissionPct: Prisma.Decimal.Value }>,
  input: Pick<SettleInput, "returned" | "discounts">,
  rules: { maxDiscount: Prisma.Decimal.Value; step: Prisma.Decimal.Value },
  names: ReadonlyMap<string, string> = new Map(),
) {
  const name = (productId: string) => names.get(productId) ?? "that product";
  const byProduct = new Map<string, { out: number; price: Prisma.Decimal; perBag: Prisma.Decimal; pct: Prisma.Decimal }>();
  for (const line of lines) {
    const entry = byProduct.get(line.productId);
    if (entry) entry.out += line.bagsOut;
    else byProduct.set(line.productId, { out: line.bagsOut, price: D(line.unitPrice), perBag: D(line.commissionPerBag), pct: D(line.commissionPct) });
  }
  const back = new Map<string, number>();
  for (const row of input.returned) {
    if (!byProduct.has(row.productId)) throw millRefusal("A returned line names a product the seller did not take.");
    if (!Number.isInteger(row.bags) || row.bags < 0) throw millRefusal(`Enter the bags of ${name(row.productId)} brought back as a whole number.`);
    back.set(row.productId, (back.get(row.productId) ?? 0) + row.bags);
  }
  const max = D(rules.maxDiscount);
  const step = D(rules.step);
  const discounted = new Map<string, number>();
  let discountTotal = ZERO;
  const discountByProduct = new Map<string, Prisma.Decimal>();
  for (const row of input.discounts) {
    if (!byProduct.has(row.productId)) throw millRefusal("A discount names a product the seller did not take.");
    if (!Number.isInteger(row.bags) || row.bags <= 0) throw millRefusal(`Enter the bags of ${name(row.productId)} sold at a discount as a whole number.`);
    const off = D(row.discount);
    if (off.lte(0)) throw millRefusal("A discount is more than nothing off a bag.");
    if (off.gt(max)) throw millRefusal(`A seller may take at most $${max.toFixed(2)} off a bag.`);
    if (!off.mod(step).isZero()) throw millRefusal(`Discounts go in steps of $${step.toFixed(2)}.`);
    discounted.set(row.productId, (discounted.get(row.productId) ?? 0) + row.bags);
    const amount = off.times(row.bags);
    discountTotal = discountTotal.plus(amount);
    discountByProduct.set(row.productId, (discountByProduct.get(row.productId) ?? ZERO).plus(amount));
  }

  let gross = ZERO;
  let commission = ZERO;
  const products: Array<{ productId: string; out: number; back: number; sold: number; gross: Prisma.Decimal; discount: Prisma.Decimal; commission: Prisma.Decimal }> = [];
  for (const [productId, entry] of byProduct) {
    const returned = back.get(productId) ?? 0;
    if (returned > entry.out) throw millRefusal(`More bags of ${name(productId)} came back (${returned}) than went out (${entry.out}).`);
    const sold = entry.out - returned;
    if ((discounted.get(productId) ?? 0) > sold) throw millRefusal(`Discounts are on more bags of ${name(productId)} than were sold (${sold}).`);
    const productGross = entry.price.times(sold);
    const productDiscount = discountByProduct.get(productId) ?? ZERO;
    const productCommission = entry.perBag.times(sold).plus(productGross.minus(productDiscount).times(entry.pct).dividedBy(100)).toDecimalPlaces(2);
    gross = gross.plus(productGross);
    commission = commission.plus(productCommission);
    products.push({ productId, out: entry.out, back: returned, sold, gross: productGross, discount: productDiscount, commission: productCommission });
  }
  return { products, gross, discount: discountTotal, due: gross.minus(discountTotal), commission };
}

/**
 * The seller is back: count what they brought, take their money. Bags back go
 * to the store, bags sold leave stock, and whatever was owed and not handed in
 * stays on the seller until paid.
 */
export async function settleSellerTrip(db: Db, args: { companyId: string; userId: string; tripId: string } & SettleInput) {
  const cash = D(args.cashReceived);
  if (cash.lt(0) || !cash.equals(cash.toDecimalPlaces(2))) throw millRefusal("Enter the cash handed in, in dollars and cents.");

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "MillingSellerTrip" WHERE "id" = ${args.tripId} FOR UPDATE`;
    const trip = await tx.millingSellerTrip.findFirst({ where: { id: args.tripId, companyId: args.companyId }, include: { lines: true } });
    if (!trip) throw millRefusal("That trip is not in this workspace.");
    if (trip.status !== "OUT") throw millRefusal(`${trip.code} is ${trip.status.toLowerCase()}.`);
    const { employee } = await sellerOrThrow(tx, args.companyId, trip.sellerId);
    if (employee.userId && employee.userId === args.userId) throw millRefusal("Someone else has to count your bags and take your money.");

    const settings = await tx.millingSettings.findUnique({ where: { companyId: args.companyId } });
    const products = await tx.product.findMany({ where: { id: { in: trip.lines.map((line) => line.productId) } }, select: { id: true, name: true } });
    const figures = settlementFigures(
      trip.lines,
      args,
      { maxDiscount: settings?.sellerMaxDiscount ?? 1, step: settings?.sellerDiscountStep ?? 0.1 },
      new Map(products.map((product) => [product.id, product.name])),
    );

    const before = await sellerBalance(tx, args.companyId, trip.sellerId);
    const owedNow = before.plus(figures.due);
    if (cash.gt(owedNow)) throw millRefusal(`$${cash.toFixed(2)} is more than ${employee.name} owes ($${owedNow.toFixed(2)}). Count the cash again.`);

    // Stock: bags back return to the store from the newest lot, so the oldest bags are the ones sold.
    const source = { companyId: args.companyId, userId: args.userId, sourceType: SELLER_TRIP_ENTITY, sourceId: trip.id, reference: trip.code };
    for (const product of figures.products) {
      const lines = trip.lines.filter((line) => line.productId === product.productId);
      const order = await tx.millingLot.findMany({ where: { id: { in: lines.map((line) => line.lotId) } }, select: { id: true, producedAt: true } });
      lines.sort((a, b) => (order.find((lot) => lot.id === b.lotId)?.producedAt.getTime() ?? 0) - (order.find((lot) => lot.id === a.lotId)?.producedAt.getTime() ?? 0));
      let back = product.back;
      for (const line of lines) {
        const lineBack = Math.min(back, line.bagsOut);
        back -= lineBack;
        const lineSold = line.bagsOut - lineBack;
        if (line.reservationId) await releaseReservation(tx, { companyId: args.companyId, reservationId: line.reservationId });
        if (lineBack > 0) await moveLot(tx, { ...source, lotId: line.lotId, fromLocationId: trip.withSellersLocationId, toLocationId: trip.fromLocationId, quantity: lineBack });
        if (lineSold > 0) await issueFromLot(tx, { ...source, lotId: line.lotId, stockLocationId: trip.withSellersLocationId, quantity: lineSold, reason: "SELLER_SALE" });
        await tx.millingSellerTripLine.update({ where: { id: line.id }, data: { bagsBack: lineBack, bagsSold: lineSold } });
      }
    }

    if (args.discounts.length) {
      await tx.millingSellerDiscount.createMany({
        data: args.discounts.map((row) => ({ tripId: trip.id, productId: row.productId, discount: D(row.discount), bags: row.bags })),
      });
    }
    if (cash.gt(0)) {
      await tx.millingSellerPayment.create({
        data: { companyId: args.companyId, sellerId: trip.sellerId, tripId: trip.id, kind: "SETTLEMENT", amount: cash, receivedById: args.userId },
      });
    }
    // The trip's own shortage: what this trip asked for and did not get. Cash above it went to an older debt.
    const shortage = Prisma.Decimal.max(figures.due.minus(cash), ZERO);
    const settled = await tx.millingSellerTrip.update({
      where: { id: trip.id },
      data: {
        status: "SETTLED",
        settledById: args.userId,
        settledAt: new Date(),
        grossAmount: figures.gross,
        discountAmount: figures.discount,
        amountDue: figures.due,
        cashReceived: cash,
        shortage,
        commissionAmount: figures.commission,
        notes: [trip.notes, args.notes?.trim()].filter(Boolean).join("\n") || null,
      },
      include: { lines: true, discounts: true },
    });
    await audit(tx, args.companyId, args.userId, trip.id, "settled", {
      due: figures.due.toFixed(2),
      cash: cash.toFixed(2),
      shortage: shortage.toFixed(2),
      commission: figures.commission.toFixed(2),
    });
    return { trip: settled, owed: owedNow.minus(cash) };
  });
}

/** Call a trip off before anything is sold: every bag goes back to the store. */
export async function cancelSellerTrip(db: Db, args: { companyId: string; userId: string; tripId: string; reason: string }) {
  const reason = args.reason.trim();
  if (!reason) throw millRefusal("Say why the trip is called off.");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "MillingSellerTrip" WHERE "id" = ${args.tripId} FOR UPDATE`;
    const trip = await tx.millingSellerTrip.findFirst({ where: { id: args.tripId, companyId: args.companyId }, include: { lines: true } });
    if (!trip) throw millRefusal("That trip is not in this workspace.");
    if (trip.status !== "OUT") throw millRefusal(`${trip.code} is ${trip.status.toLowerCase()}.`);
    const source = { companyId: args.companyId, userId: args.userId, sourceType: SELLER_TRIP_ENTITY, sourceId: trip.id, reference: trip.code };
    for (const line of trip.lines) {
      if (line.reservationId) await releaseReservation(tx, { companyId: args.companyId, reservationId: line.reservationId });
      await moveLot(tx, { ...source, lotId: line.lotId, fromLocationId: trip.withSellersLocationId, toLocationId: trip.fromLocationId, quantity: line.bagsOut });
      await tx.millingSellerTripLine.update({ where: { id: line.id }, data: { bagsBack: line.bagsOut, bagsSold: 0 } });
    }
    const cancelled = await tx.millingSellerTrip.update({ where: { id: trip.id }, data: { status: "CANCELLED", settledById: args.userId, settledAt: new Date() } });
    await audit(tx, args.companyId, args.userId, trip.id, "cancelled", undefined, reason);
    return cancelled;
  });
}

/** Money a seller hands in later, against what they owe. */
export async function recordSellerPayment(db: Db, args: { companyId: string; userId: string; sellerId: string; amount: number; notes?: string | null }) {
  const amount = D(args.amount);
  if (amount.lte(0) || !amount.equals(amount.toDecimalPlaces(2))) throw millRefusal("Enter the amount handed in, in dollars and cents.");
  return db.$transaction(async (tx) => {
    const { seller, employee } = await sellerOrThrow(tx, args.companyId, args.sellerId);
    await tx.$queryRaw`SELECT "id" FROM "MillingSeller" WHERE "id" = ${seller.id} FOR UPDATE`;
    if (employee.userId && employee.userId === args.userId) throw millRefusal("Someone else has to take your payment.");
    const owed = await sellerBalance(tx, args.companyId, seller.id);
    if (owed.lte(0)) throw millRefusal(`${employee.name} owes nothing.`);
    if (amount.gt(owed)) throw millRefusal(`${employee.name} owes $${owed.toFixed(2)}; $${amount.toFixed(2)} is more than that.`);
    const payment = await tx.millingSellerPayment.create({
      data: { companyId: args.companyId, sellerId: seller.id, kind: "REPAYMENT", amount, receivedById: args.userId, notes: args.notes?.trim() || null },
    });
    await writePlatformAuditEvent(
      { companyId: args.companyId, actorId: args.userId, eventType: "milling.seller.paid", entityType: "MillingSeller", entityId: seller.id, payload: { amount: amount.toFixed(2), owedBefore: owed.toFixed(2) } },
      tx,
    );
    return { payment, owed: owed.minus(amount) };
  });
}
