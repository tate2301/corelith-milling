import { Prisma, type UnitOfMeasure } from "@prisma/client";

import { unitLabel } from "@/lib/inventory/catalogue";
import { recordStockMovement } from "@/lib/inventory/stock-movements";

/**
 * The mill's stock ledger (DECISIONS.md, D7): quantities by lot and by
 * location, kept in step with core's on-hand totals.
 *
 * Every function here takes the caller's transaction. A change to the total
 * (a receipt, an issue, a count) calls core's `recordStockMovement` with the
 * same transaction, then moves the lot; a move between bins changes only the
 * lot. So for each product, the lots' balances add up to core's on-hand.
 *
 * Quantities are in the product's own unit: kg for maize and bulk product,
 * bags for packed product, each for empty bags.
 */

export type Tx = Prisma.TransactionClient;
type Qty = Prisma.Decimal | number | string;

export class StockLedgerError extends Error {}

export const LOT_STATUSES = ["AVAILABLE", "HOLD", "REJECTED", "CONSUMED"] as const;
export type LotStatus = (typeof LOT_STATUSES)[number];

/** The reasons a lot moves; the first word says whether the mill's total changes. */
export type LotReason =
  | "INTAKE_RECEIPT"
  | "OPENING"
  | "PRODUCTION_OUTPUT"
  | "PACK_OUTPUT"
  | "PACK_RETURN"
  | "DELIVERY_RETURN"
  | "PRODUCTION_ISSUE"
  | "PACK_ISSUE"
  | "DESPATCH"
  | "QC_DISPOSAL"
  | "RETURN_TO_SUPPLIER"
  | "COUNT_ADJUSTMENT"
  | "WEIGHT_CORRECTION"
  | "BIN_MOVE";

/** Issues allowed from a lot on hold or rejected: getting rid of it. */
const DISPOSALS: ReadonlySet<LotReason> = new Set(["QC_DISPOSAL", "RETURN_TO_SUPPLIER"]);

const dec = (value: Qty) => new Prisma.Decimal(value);

export interface Source {
  companyId: string;
  userId: string;
  /** The record that caused it, e.g. "MillingIntake" and its id. */
  sourceType: string;
  sourceId?: string | null;
  /** A number a person reads, e.g. MI-261116-01. */
  reference?: string | null;
  isEstimated?: boolean;
  notes?: string | null;
}

/** The core stock line for a product at the mill's site, made the first time it is needed. */
export async function inventoryLineFor(tx: Tx, companyId: string, productId: string, siteId: string) {
  const existing = await tx.inventoryItem.findFirst({
    where: { siteId, productId },
    select: { id: true, unit: true },
  });
  if (existing) return existing;
  const product = await tx.product.findFirst({
    where: { id: productId, companyId },
    select: { code: true, name: true, unit: true, unitLabel: true, category: true },
  });
  if (!product) throw new StockLedgerError("That product is not in this workspace.");
  const place = await tx.stockLocation.findFirst({
    where: { siteId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  if (!place) throw new StockLedgerError("The mill's site has no stock location.");
  return tx.inventoryItem.create({
    data: {
      itemCode: product.code ?? productId.slice(0, 8),
      name: product.name,
      category: product.category ?? "MILLING",
      unit: unitLabel({ unit: product.unit as UnitOfMeasure, unitLabel: product.unitLabel }),
      siteId,
      locationId: place.id,
      productId,
    },
    select: { id: true, unit: true },
  });
}

/** The location, checked to be the company's, with its site. */
async function locationOf(tx: Tx, companyId: string, stockLocationId: string) {
  const location = await tx.stockLocation.findFirst({
    where: { id: stockLocationId, site: { companyId } },
    select: { id: true, siteId: true, code: true },
  });
  if (!location) throw new StockLedgerError("That location is not at the mill.");
  return location;
}

async function lockLot(tx: Tx, companyId: string, lotId: string) {
  await tx.$queryRaw`SELECT "id" FROM "MillingLot" WHERE "id" = ${lotId} FOR UPDATE`;
  const lot = await tx.millingLot.findFirst({ where: { id: lotId, companyId } });
  if (!lot) throw new StockLedgerError("That lot is not at the mill.");
  return lot;
}

async function balanceAt(tx: Tx, companyId: string, lotId: string, stockLocationId: string) {
  return tx.millingLotBalance.upsert({
    where: { lotId_stockLocationId: { lotId, stockLocationId } },
    update: {},
    create: { companyId, lotId, stockLocationId },
  });
}

/** Create a lot. It starts on HOLD unless told otherwise: nothing is usable until QC says so. */
export async function createLot(
  tx: Tx,
  args: {
    companyId: string;
    code: string;
    productId: string;
    status?: LotStatus;
    originType: string;
    originId?: string | null;
    attributes?: Prisma.InputJsonValue;
    producedAt?: Date;
  },
) {
  const product = await tx.product.findFirst({ where: { id: args.productId, companyId: args.companyId }, select: { id: true } });
  if (!product) throw new StockLedgerError("That product is not in this workspace.");
  return tx.millingLot.create({
    data: {
      companyId: args.companyId,
      code: args.code,
      productId: args.productId,
      status: args.status ?? "HOLD",
      originType: args.originType,
      originId: args.originId ?? null,
      attributes: args.attributes,
      producedAt: args.producedAt,
    },
  });
}

/** Stock arriving at the mill into a lot at a location: core RECEIPT, then the lot. */
export async function receiveIntoLot(
  tx: Tx,
  args: Source & { lotId: string; stockLocationId: string; quantity: Qty; reason: LotReason; unitCost?: Qty },
) {
  const quantity = dec(args.quantity);
  if (quantity.lte(0)) throw new StockLedgerError("A receipt needs a quantity above nothing.");
  const lot = await lockLot(tx, args.companyId, args.lotId);
  if (lot.status === "CONSUMED") throw new StockLedgerError("That lot is used up.");
  const location = await locationOf(tx, args.companyId, args.stockLocationId);
  const line = await inventoryLineFor(tx, args.companyId, lot.productId, location.siteId);

  const core = await recordStockMovement({
    tx,
    companyId: args.companyId,
    userId: args.userId,
    itemId: line.id,
    movementType: "RECEIPT",
    quantity,
    unit: line.unit,
    unitCost: args.unitCost,
    reason: null,
    reference: args.reference ?? lot.code,
    sourceType: "STOCK_RECEIPT",
    sourceId: args.sourceId ?? null,
    notes: args.notes ?? `${args.reason} ${lot.code}`,
  });
  await balanceAt(tx, args.companyId, lot.id, location.id);
  await tx.millingLotBalance.update({
    where: { lotId_stockLocationId: { lotId: lot.id, stockLocationId: location.id } },
    data: { quantity: { increment: quantity } },
  });
  return tx.millingLotMovement.create({
    data: {
      companyId: args.companyId,
      lotId: lot.id,
      toLocationId: location.id,
      quantity,
      reason: args.reason,
      stockMovementId: core.movement.id,
      sourceType: args.sourceType,
      sourceId: args.sourceId ?? null,
      isEstimated: args.isEstimated ?? false,
      createdById: args.userId,
    },
  });
}

/**
 * Stock leaving a lot: into production, a pack run, a truck, or disposal.
 * Refuses a lot on hold or rejected (except to dispose of it), and more than
 * is free: reserved stock is only for the record that reserved it.
 */
export async function issueFromLot(
  tx: Tx,
  args: Source & {
    lotId: string;
    stockLocationId: string;
    quantity: Qty;
    reason: LotReason;
    /** Fulfil this reservation with the issue, so its quantity is not counted as taken. */
    reservationId?: string | null;
  },
) {
  const quantity = dec(args.quantity);
  if (quantity.lte(0)) throw new StockLedgerError("An issue needs a quantity above nothing.");
  const lot = await lockLot(tx, args.companyId, args.lotId);
  if (lot.status !== "AVAILABLE" && !DISPOSALS.has(args.reason)) {
    throw new StockLedgerError(`Lot ${lot.code} is ${lot.status.toLowerCase()}; it cannot be used until QC releases it.`);
  }
  const location = await locationOf(tx, args.companyId, args.stockLocationId);
  const balance = await balanceAt(tx, args.companyId, lot.id, location.id);

  let reservedForThis = new Prisma.Decimal(0);
  if (args.reservationId) {
    const reservation = await tx.millingReservation.findFirst({
      where: { id: args.reservationId, companyId: args.companyId, lotId: lot.id, stockLocationId: location.id, status: "ACTIVE" },
    });
    if (!reservation) throw new StockLedgerError("That reservation is not open on this lot and location.");
    reservedForThis = Prisma.Decimal.min(reservation.quantity, quantity);
  }
  const free = balance.quantity.minus(balance.reserved).plus(reservedForThis);
  if (free.lt(quantity)) {
    throw new StockLedgerError(`Only ${free.toString()} of lot ${lot.code} is free at ${location.code}.`);
  }

  const line = await inventoryLineFor(tx, args.companyId, lot.productId, location.siteId);
  const core = await recordStockMovement({
    tx,
    companyId: args.companyId,
    userId: args.userId,
    itemId: line.id,
    movementType: "ISSUE",
    quantity,
    unit: line.unit,
    reason: null,
    reference: args.reference ?? lot.code,
    sourceType: "STOCK_ISSUE",
    sourceId: args.sourceId ?? null,
    notes: args.notes ?? `${args.reason} ${lot.code}`,
  });

  await tx.millingLotBalance.update({
    where: { id: balance.id },
    data: { quantity: { decrement: quantity }, reserved: { decrement: reservedForThis } },
  });
  if (args.reservationId) {
    await tx.millingReservation.update({
      where: { id: args.reservationId },
      data: { status: "FULFILLED", closedAt: new Date() },
    });
  }
  await markConsumedIfEmpty(tx, lot.id);
  return tx.millingLotMovement.create({
    data: {
      companyId: args.companyId,
      lotId: lot.id,
      fromLocationId: location.id,
      quantity,
      reason: args.reason,
      stockMovementId: core.movement.id,
      sourceType: args.sourceType,
      sourceId: args.sourceId ?? null,
      isEstimated: args.isEstimated ?? false,
      createdById: args.userId,
    },
  });
}

/** A lot with nothing left anywhere is used up. */
async function markConsumedIfEmpty(tx: Tx, lotId: string) {
  const left = await tx.millingLotBalance.aggregate({ where: { lotId }, _sum: { quantity: true } });
  if ((left._sum.quantity ?? new Prisma.Decimal(0)).lte(0)) {
    await tx.millingLot.update({ where: { id: lotId }, data: { status: "CONSUMED" } });
  }
}

/** Part of a lot from one bin to another. The mill's total does not change, so core is not told. */
export async function moveLot(
  tx: Tx,
  args: Source & { lotId: string; fromLocationId: string; toLocationId: string; quantity: Qty },
) {
  const quantity = dec(args.quantity);
  if (quantity.lte(0)) throw new StockLedgerError("A move needs a quantity above nothing.");
  if (args.fromLocationId === args.toLocationId) throw new StockLedgerError("Choose a different location to move to.");
  const lot = await lockLot(tx, args.companyId, args.lotId);
  const [from, to] = await Promise.all([
    locationOf(tx, args.companyId, args.fromLocationId),
    locationOf(tx, args.companyId, args.toLocationId),
  ]);
  if (from.siteId !== to.siteId) throw new StockLedgerError("A move stays at one site.");
  const source = await balanceAt(tx, args.companyId, lot.id, from.id);
  if (source.quantity.minus(source.reserved).lt(quantity)) {
    throw new StockLedgerError(`Only ${source.quantity.minus(source.reserved).toString()} of lot ${lot.code} is free at ${from.code}.`);
  }
  await balanceAt(tx, args.companyId, lot.id, to.id);
  await tx.millingLotBalance.update({ where: { id: source.id }, data: { quantity: { decrement: quantity } } });
  await tx.millingLotBalance.update({
    where: { lotId_stockLocationId: { lotId: lot.id, stockLocationId: to.id } },
    data: { quantity: { increment: quantity } },
  });
  return tx.millingLotMovement.create({
    data: {
      companyId: args.companyId,
      lotId: lot.id,
      fromLocationId: from.id,
      toLocationId: to.id,
      quantity,
      reason: "BIN_MOVE",
      sourceType: args.sourceType,
      sourceId: args.sourceId ?? null,
      isEstimated: args.isEstimated ?? false,
      createdById: args.userId,
    },
  });
}

/** Set a lot's balance at a location to what was found (a count) or confirmed (a weight): core ADJUSTMENT for the difference. */
export async function adjustLotTo(
  tx: Tx,
  args: Source & { lotId: string; stockLocationId: string; quantity: Qty; reason: "COUNT_ADJUSTMENT" | "WEIGHT_CORRECTION" },
) {
  const target = dec(args.quantity);
  if (target.lt(0)) throw new StockLedgerError("A quantity cannot be below nothing.");
  const lot = await lockLot(tx, args.companyId, args.lotId);
  const location = await locationOf(tx, args.companyId, args.stockLocationId);
  const balance = await balanceAt(tx, args.companyId, lot.id, location.id);
  const change = target.minus(balance.quantity);
  if (change.isZero()) return null;
  if (target.lt(balance.reserved)) {
    throw new StockLedgerError(`Lot ${lot.code} has ${balance.reserved.toString()} promised at ${location.code}; release it first.`);
  }
  const line = await inventoryLineFor(tx, args.companyId, lot.productId, location.siteId);
  const core = await recordStockMovement({
    tx,
    companyId: args.companyId,
    userId: args.userId,
    itemId: line.id,
    movementType: "ADJUSTMENT",
    quantity: change,
    unit: line.unit,
    reason: args.reason === "COUNT_ADJUSTMENT" ? "COUNT" : "CORRECTION",
    reference: args.reference ?? lot.code,
    sourceType: "STOCK_ADJUSTMENT",
    sourceId: args.sourceId ?? null,
    notes: args.notes ?? `${args.reason} ${lot.code}`,
  });
  await tx.millingLotBalance.update({ where: { id: balance.id }, data: { quantity: target } });
  if (lot.status === "CONSUMED" && target.gt(0)) {
    await tx.millingLot.update({ where: { id: lot.id }, data: { status: "AVAILABLE" } });
  } else {
    await markConsumedIfEmpty(tx, lot.id);
  }
  return tx.millingLotMovement.create({
    data: {
      companyId: args.companyId,
      lotId: lot.id,
      fromLocationId: change.lt(0) ? location.id : null,
      toLocationId: change.gt(0) ? location.id : null,
      quantity: change.abs(),
      reason: args.reason,
      stockMovementId: core.movement.id,
      sourceType: args.sourceType,
      sourceId: args.sourceId ?? null,
      createdById: args.userId,
    },
  });
}

export async function setLotStatus(tx: Tx, args: { companyId: string; lotId: string; status: LotStatus }) {
  const lot = await lockLot(tx, args.companyId, args.lotId);
  if (lot.status === "CONSUMED") throw new StockLedgerError(`Lot ${lot.code} is used up.`);
  return tx.millingLot.update({ where: { id: lot.id }, data: { status: args.status } });
}

/** Promise part of a lot to a record (an order, a batch) so nothing else takes it. */
export async function reserve(
  tx: Tx,
  args: { companyId: string; userId: string; lotId: string; stockLocationId: string; quantity: Qty; sourceType: string; sourceId: string },
) {
  const quantity = dec(args.quantity);
  if (quantity.lte(0)) throw new StockLedgerError("A reservation needs a quantity above nothing.");
  const lot = await lockLot(tx, args.companyId, args.lotId);
  if (lot.status !== "AVAILABLE") throw new StockLedgerError(`Lot ${lot.code} is ${lot.status.toLowerCase()} and cannot be promised.`);
  const balance = await balanceAt(tx, args.companyId, lot.id, args.stockLocationId);
  if (balance.quantity.minus(balance.reserved).lt(quantity)) {
    throw new StockLedgerError(`Only ${balance.quantity.minus(balance.reserved).toString()} of lot ${lot.code} is free.`);
  }
  await tx.millingLotBalance.update({ where: { id: balance.id }, data: { reserved: { increment: quantity } } });
  return tx.millingReservation.create({
    data: {
      companyId: args.companyId,
      lotId: lot.id,
      stockLocationId: args.stockLocationId,
      quantity,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      createdById: args.userId,
    },
  });
}

/** Give back what a reservation held, e.g. when an order is cancelled. */
export async function releaseReservation(tx: Tx, args: { companyId: string; reservationId: string }) {
  const reservation = await tx.millingReservation.findFirst({
    where: { id: args.reservationId, companyId: args.companyId, status: "ACTIVE" },
  });
  if (!reservation) throw new StockLedgerError("That reservation is not open.");
  await lockLot(tx, args.companyId, reservation.lotId);
  await tx.millingLotBalance.update({
    where: { lotId_stockLocationId: { lotId: reservation.lotId, stockLocationId: reservation.stockLocationId } },
    data: { reserved: { decrement: reservation.quantity } },
  });
  return tx.millingReservation.update({ where: { id: reservation.id }, data: { status: "RELEASED", closedAt: new Date() } });
}

/**
 * The invariant (D7), product by product: the lots' total against core's
 * on-hand at the mill's site. A difference is stock "not in a lot".
 */
export async function lotsAgainstCore(tx: Tx | Prisma.TransactionClient, companyId: string, siteId: string) {
  const [lines, sums, lots] = await Promise.all([
    tx.inventoryItem.findMany({ where: { siteId, productId: { not: null } }, select: { productId: true, currentStock: true } }),
    tx.millingLotBalance.groupBy({ by: ["lotId"], where: { companyId }, _sum: { quantity: true } }),
    tx.millingLot.findMany({ where: { companyId }, select: { id: true, productId: true } }),
  ]);
  const byProduct = new Map<string, Prisma.Decimal>();
  const productOf = new Map(lots.map((lot) => [lot.id, lot.productId]));
  for (const sum of sums) {
    const productId = productOf.get(sum.lotId);
    if (!productId) continue;
    byProduct.set(productId, (byProduct.get(productId) ?? new Prisma.Decimal(0)).plus(sum._sum.quantity ?? 0));
  }
  return lines.map((line) => {
    const inLots = byProduct.get(line.productId!) ?? new Prisma.Decimal(0);
    return { productId: line.productId!, onHand: line.currentStock, inLots, notInALot: line.currentStock.minus(inLots) };
  });
}

/**
 * Issue a quantity of a product from its available lots, oldest first, across
 * locations: bags and thread for packing, where which lot does not matter.
 */
export async function issueOldestFirst(
  tx: Tx,
  args: Source & { productId: string; quantity: Qty; reason: LotReason; label: string },
) {
  let left = dec(args.quantity);
  if (left.lte(0)) return [];
  const balances = await tx.millingLotBalance.findMany({
    where: { companyId: args.companyId, lot: { productId: args.productId, status: "AVAILABLE" } },
    include: { lot: { select: { producedAt: true } } },
  });
  balances.sort((a, b) => a.lot.producedAt.getTime() - b.lot.producedAt.getTime());
  const free = balances.reduce((sum, row) => sum.plus(row.quantity).minus(row.reserved), new Prisma.Decimal(0));
  if (free.lt(left)) throw new StockLedgerError(`Not enough ${args.label}: ${free.toString()} free, ${left.toString()} needed.`);
  const movements = [];
  for (const balance of balances) {
    if (left.lte(0)) break;
    const take = Prisma.Decimal.min(balance.quantity.minus(balance.reserved), left);
    if (take.lte(0)) continue;
    movements.push(await issueFromLot(tx, { ...args, lotId: balance.lotId, stockLocationId: balance.stockLocationId, quantity: take }));
    left = left.minus(take);
  }
  return movements;
}
