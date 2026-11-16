import { Prisma, type PrismaClient } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";

import { raiseException } from "../exceptions/exceptions";
import { nextDailyCode } from "../records/codes";
import { adjustLotTo, createLot, receiveIntoLot } from "./ledger";

/**
 * Counting a location (plan v2, L2). What was found in each lot is compared
 * with the ledger. Lines within the mill's tolerance post at once; a larger
 * difference raises a stock discrepancy, and nothing posts until management
 * decides to post or discard the count.
 */

type Tx = Prisma.TransactionClient;
export const COUNT_ENTITY = "MillingStockCount";

export class CountError extends Error {}

export interface CountLineInput {
  lotId: string;
  counted: number | string;
}

/** Outside tolerance: more than the tolerance % of what was expected, or anything found where nothing was expected. */
export function outsideTolerance(expected: Prisma.Decimal, counted: Prisma.Decimal, tolerancePct: number): boolean {
  const difference = counted.minus(expected).abs();
  if (difference.isZero()) return false;
  if (expected.isZero()) return true;
  return difference.div(expected).times(100).gt(tolerancePct);
}

export async function submitCount(
  db: PrismaClient,
  args: { companyId: string; userId: string; stockLocationId: string; lines: CountLineInput[]; notes?: string | null },
) {
  return db.$transaction(async (tx) => {
    const location = await tx.stockLocation.findFirst({ where: { id: args.stockLocationId, site: { companyId: args.companyId } }, select: { id: true, code: true } });
    if (!location) throw new CountError("That location is not at the mill.");
    const balances = await tx.millingLotBalance.findMany({
      where: { companyId: args.companyId, stockLocationId: location.id },
      include: { lot: { select: { id: true, code: true, status: true } } },
    });
    const expected = new Map(balances.map((balance) => [balance.lotId, balance]));
    const lines = args.lines.map((line) => {
      const counted = new Prisma.Decimal(line.counted);
      if (counted.lt(0)) throw new CountError("A count cannot be below nothing.");
      return { lotId: line.lotId, counted };
    });
    for (const line of lines) {
      if (!expected.has(line.lotId)) {
        const lot = await tx.millingLot.findFirst({ where: { id: line.lotId, companyId: args.companyId }, select: { id: true } });
        if (!lot) throw new CountError("A line names a lot that is not at the mill.");
      }
    }
    const missing = balances.filter((balance) => balance.quantity.gt(0) && !lines.some((line) => line.lotId === balance.lotId));
    if (missing.length) throw new CountError(`Count every lot here, including ${missing.map((balance) => balance.lot.code).join(", ")} (enter 0 if it is gone).`);

    const settings = await tx.millingSettings.findUnique({ where: { companyId: args.companyId } });
    const tolerance = Number(settings?.reconciliationTolerancePct ?? 2);
    const counted = lines.map((line) => ({ ...line, expected: expected.get(line.lotId)?.quantity ?? new Prisma.Decimal(0) }));
    const over = counted.filter((line) => outsideTolerance(line.expected, line.counted, tolerance));

    const code = await nextDailyCode(tx, "millingStockCount", args.companyId, "SC");
    const count = await tx.millingStockCount.create({
      data: {
        companyId: args.companyId,
        code,
        stockLocationId: location.id,
        status: over.length ? "AWAITING_DECISION" : "POSTED",
        countedById: args.userId,
        notes: args.notes ?? null,
        postedAt: over.length ? null : new Date(),
        lines: { create: counted.map((line) => ({ lotId: line.lotId, expected: line.expected, counted: line.counted })) },
      },
      include: { lines: true },
    });
    await writePlatformAuditEvent(
      { companyId: args.companyId, actorId: args.userId, eventType: "milling.count.submitted", entityType: COUNT_ENTITY, entityId: count.id, payload: { code, lines: count.lines.length, overTolerance: over.length } },
      tx,
    );

    if (over.length) {
      await raiseException(tx, {
        companyId: args.companyId,
        raisedById: args.userId,
        type: "STOCK_DISCREPANCY",
        targetType: COUNT_ENTITY,
        targetId: count.id,
        title: `${code} at ${location.code}: ${over.length} lot${over.length === 1 ? "" : "s"} off by more than ${tolerance}%`,
        detail: over.map((line) => `${line.lotId}: expected ${line.expected.toString()}, counted ${line.counted.toString()}`).join("; "),
        allowedDecisions: ["POST_COUNT", "DISCARD_COUNT"],
        severity: "HIGH",
      });
    } else {
      await postLines(tx, { companyId: args.companyId, userId: args.userId, count });
    }
    return count;
  });
}

/**
 * Put a count's differences on the ledger. Stock may have moved since the
 * count, so each lot moves by the difference found, not to the figure counted.
 */
async function postLines(
  tx: Tx,
  args: { companyId: string; userId: string; count: { id: string; code: string; stockLocationId: string; lines: Array<{ lotId: string; expected: Prisma.Decimal; counted: Prisma.Decimal }> } },
) {
  for (const line of args.count.lines) {
    const difference = line.counted.minus(line.expected);
    if (difference.isZero()) continue;
    const balance = await tx.millingLotBalance.findUnique({
      where: { lotId_stockLocationId: { lotId: line.lotId, stockLocationId: args.count.stockLocationId } },
    });
    const target = Prisma.Decimal.max((balance?.quantity ?? new Prisma.Decimal(0)).plus(difference), 0);
    await adjustLotTo(tx, {
      companyId: args.companyId,
      userId: args.userId,
      lotId: line.lotId,
      stockLocationId: args.count.stockLocationId,
      quantity: target,
      reason: "COUNT_ADJUSTMENT",
      sourceType: COUNT_ENTITY,
      sourceId: args.count.id,
      reference: args.count.code,
    });
  }
}

/** Management's decision on a count over tolerance: post it, or discard it. */
export async function settleCountIn(tx: Tx, args: { companyId: string; userId: string; countId: string; post: boolean }) {
  const count = await tx.millingStockCount.findFirst({ where: { id: args.countId, companyId: args.companyId }, include: { lines: true } });
  if (!count) throw new CountError("That count is not in this workspace.");
  if (count.status !== "AWAITING_DECISION") throw new CountError(`${count.code} is already ${count.status.toLowerCase()}.`);
  if (args.post) await postLines(tx, { companyId: args.companyId, userId: args.userId, count });
  return tx.millingStockCount.update({
    where: { id: count.id },
    data: args.post ? { status: "POSTED", postedAt: new Date() } : { status: "DISCARDED" },
  });
}

/** Opening stock at go-live (plan v2, 2.12): an available lot per product and place. */
export async function recordOpeningStock(
  db: PrismaClient,
  args: { companyId: string; userId: string; productId: string; stockLocationId: string; quantity: number | string; unitCost?: number | string | null; lotCode?: string | null },
) {
  return db.$transaction(async (tx) => {
    const product = await tx.product.findFirst({ where: { id: args.productId, companyId: args.companyId }, select: { code: true } });
    if (!product) throw new CountError("That product is not in this workspace.");
    const code = args.lotCode?.trim() || (await nextDailyCode(tx, "millingLot", args.companyId, `OPEN-${product.code ?? "ITEM"}`));
    const lot = await createLot(tx, { companyId: args.companyId, code, productId: args.productId, status: "AVAILABLE", originType: "OPENING" });
    await receiveIntoLot(tx, {
      companyId: args.companyId,
      userId: args.userId,
      lotId: lot.id,
      stockLocationId: args.stockLocationId,
      quantity: args.quantity,
      unitCost: args.unitCost ?? undefined,
      reason: "OPENING",
      sourceType: "MillingOpening",
      sourceId: lot.id,
      reference: code,
    });
    return lot;
  });
}
