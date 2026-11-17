import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";

import { millRefusal } from "../errors";
import { nextDailyCode } from "../records/codes";
import { createLot, issueFromLot, issueOldestFirst, receiveIntoLot } from "../stock/ledger";

/**
 * Packing (plan 4.8): released bulk product and empty bags in, packed bags
 * out as a new lot. Bulk used beyond bags x kg a bag is giveaway; check
 * weights record what the bags actually held. Damaged bags are used up.
 */

export const PACK_ENTITY = "MillingPackRun";
const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

export async function recordPackRun(
  db: PrismaClient,
  args: {
    companyId: string;
    userId: string;
    recipeId: string;
    bulkLotId: string;
    bulkLocationId: string;
    outputLocationId: string;
    bagsPacked: number;
    damagedBags?: number;
    bulkUsedKg: number;
    checkWeights?: number[];
    shiftId?: string | null;
  },
) {
  if (!Number.isInteger(args.bagsPacked) || args.bagsPacked <= 0) throw millRefusal("Enter the bags packed.");
  const damaged = args.damagedBags ?? 0;
  if (!Number.isInteger(damaged) || damaged < 0) throw millRefusal("Damaged bags is a whole number.");
  return db.$transaction(async (tx) => {
    const recipe = await tx.millingPackRecipe.findFirst({ where: { id: args.recipeId, companyId: args.companyId, isActive: true } });
    if (!recipe) throw millRefusal("That pack recipe is not in use.");
    const bulkLot = await tx.millingLot.findFirst({ where: { id: args.bulkLotId, companyId: args.companyId } });
    if (!bulkLot) throw millRefusal("That bulk lot is not at the mill.");
    if (bulkLot.productId !== recipe.bulkProductId) throw millRefusal("That lot is not the bulk product this recipe packs.");
    const packed = await tx.product.findUniqueOrThrow({ where: { id: recipe.packedProductId }, select: { code: true, name: true } });

    const code = await nextDailyCode(tx, "millingPackRun", args.companyId, "PK");
    const runId = randomUUID();
    const source = { companyId: args.companyId, userId: args.userId, sourceType: PACK_ENTITY, sourceId: runId, reference: code };
    await issueFromLot(tx, { ...source, lotId: bulkLot.id, stockLocationId: args.bulkLocationId, quantity: args.bulkUsedKg, reason: "PACK_ISSUE" });
    if (recipe.bagProductId) {
      await issueOldestFirst(tx, { ...source, productId: recipe.bagProductId, quantity: args.bagsPacked + damaged, reason: "PACK_ISSUE", label: "empty bags" });
    }
    if (recipe.threadPerBag) {
      const thread = await tx.product.findFirst({ where: { companyId: args.companyId, code: "THREAD" }, select: { id: true } });
      if (thread) {
        await issueOldestFirst(tx, { ...source, productId: thread.id, quantity: recipe.threadPerBag.times(args.bagsPacked), reason: "PACK_ISSUE", label: "sewing thread" });
      }
    }
    const outputLot = await createLot(tx, {
      companyId: args.companyId,
      code: `${code}-${packed.code ?? "PACK"}`,
      productId: recipe.packedProductId,
      status: "AVAILABLE",
      originType: "PACK",
      originId: runId,
      attributes: { bulkLot: bulkLot.code },
    });
    await receiveIntoLot(tx, { ...source, lotId: outputLot.id, stockLocationId: args.outputLocationId, quantity: args.bagsPacked, reason: "PACK_OUTPUT" });

    const varianceKg = D(args.bulkUsedKg).minus(recipe.kgPerBag.times(args.bagsPacked));
    const run = await tx.millingPackRun.create({
      data: {
        id: runId,
        companyId: args.companyId,
        code,
        recipeId: recipe.id,
        bulkLotId: bulkLot.id,
        bulkLocationId: args.bulkLocationId,
        outputLocationId: args.outputLocationId,
        outputLotId: outputLot.id,
        bagsPacked: args.bagsPacked,
        damagedBags: damaged,
        bulkUsedKg: args.bulkUsedKg,
        varianceKg,
        checkWeights: (args.checkWeights ?? []).filter((weight) => weight > 0).map((weight) => D(weight)),
        shiftId: args.shiftId ?? null,
        packedById: args.userId,
      },
    });
    await writePlatformAuditEvent(
      { companyId: args.companyId, actorId: args.userId, eventType: "milling.pack.recorded", entityType: PACK_ENTITY, entityId: run.id, payload: { code, bags: args.bagsPacked, damaged, varianceKg: varianceKg.toString(), product: packed.name } },
      tx,
    );
    return run;
  });
}

/** Giveaway per bag from check weights: average actual net minus the target. */
export function checkWeightSummary(weights: number[], targetKg: number) {
  if (!weights.length) return null;
  const average = weights.reduce((sum, weight) => sum + weight, 0) / weights.length;
  return { samples: weights.length, averageKg: Math.round(average * 1000) / 1000, giveawayPerBagKg: Math.round((average - targetKg) * 1000) / 1000, under: weights.filter((weight) => weight < targetKg).length };
}
