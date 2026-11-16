import { Prisma, type PrismaClient } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";

import { millRefusal } from "../errors";
import { assertNotBlocked, raiseException } from "../exceptions/exceptions";
import { assertAvailable } from "../maintenance/equipment";
import { nextDailyCode } from "../records/codes";
import { createLot, issueFromLot, receiveIntoLot } from "../stock/ledger";
import { ORDER_ENTITY } from "./orders";

/**
 * Batches (plan 4.6): maize from one or more lots through the route, out as
 * bulk product. Each stage is recorded with its own quantities, each marked
 * measured or estimated. At completion the material balance is worked out:
 *
 *   maize in + water = products + separated material + change in process + unaccounted
 *
 * Unaccounted beyond the mill's tolerance raises an exception, and the batch
 * does not complete until management decides. Bulk product goes into lots on
 * hold; QC releases them.
 */

type Tx = Prisma.TransactionClient;
export const BATCH_ENTITY = "MillingBatch";
const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

export interface Balance {
  inKg: Prisma.Decimal;
  outputKg: Prisma.Decimal;
  separatedKg: Prisma.Decimal;
  inProcessChangeKg: Prisma.Decimal;
  unaccountedKg: Prisma.Decimal;
  variancePct: Prisma.Decimal;
}

/** The material balance of a batch. Positive unaccounted is loss; negative means more came out than went in. */
export function materialBalance(args: { maizeKg: Prisma.Decimal.Value; waterKg: Prisma.Decimal.Value; outputKg: Prisma.Decimal.Value; separatedKg: Prisma.Decimal.Value; inProcessChangeKg: Prisma.Decimal.Value }): Balance {
  const inKg = D(args.maizeKg).plus(args.waterKg);
  const outputKg = D(args.outputKg);
  const separatedKg = D(args.separatedKg);
  const inProcessChangeKg = D(args.inProcessChangeKg);
  const unaccountedKg = inKg.minus(outputKg).minus(separatedKg).minus(inProcessChangeKg);
  const variancePct = inKg.isZero() ? D(0) : unaccountedKg.abs().div(inKg).times(100).toDecimalPlaces(3);
  return { inKg, outputKg, separatedKg, inProcessChangeKg, unaccountedKg, variancePct };
}

async function batchOrThrow(tx: Tx, companyId: string, batchId: string) {
  await tx.$queryRaw`SELECT "id" FROM "MillingBatch" WHERE "id" = ${batchId} FOR UPDATE`;
  const batch = await tx.millingBatch.findFirst({ where: { id: batchId, companyId }, include: { stages: true, outputs: true, sources: true } });
  if (!batch) throw millRefusal("That batch is not in this workspace.");
  return batch;
}

function assertWorking(batch: { code: string; status: string }) {
  if (!["OPEN", "IN_PROGRESS"].includes(batch.status)) throw millRefusal(`${batch.code} is ${batch.status.toLowerCase().replace(/_/g, " ")}; nothing more is recorded on it.`);
}

async function audit(tx: Tx, companyId: string, actorId: string, id: string, action: string, payload?: Record<string, unknown>) {
  await writePlatformAuditEvent({ companyId, actorId, eventType: `milling.batch.${action}`, entityType: BATCH_ENTITY, entityId: id, payload }, tx);
}

export async function startBatch(db: PrismaClient, args: { companyId: string; userId: string; orderId?: string | null; shiftId?: string | null }) {
  return db.$transaction(async (tx) => {
    if (args.orderId) {
      const order = await tx.millingProductionOrder.findFirst({ where: { id: args.orderId, companyId: args.companyId } });
      if (!order) throw millRefusal("That production order is not in this workspace.");
      if (!["APPROVED", "IN_PROGRESS"].includes(order.status)) throw millRefusal(`${order.code} is not approved.`);
      if (order.status === "APPROVED") await tx.millingProductionOrder.update({ where: { id: order.id }, data: { status: "IN_PROGRESS" } });
    }
    if (args.shiftId) {
      const shift = await tx.millingShift.findFirst({ where: { id: args.shiftId, companyId: args.companyId } });
      if (!shift || shift.status !== "OPEN") throw millRefusal("Start a batch on an open shift.");
    }
    const code = await nextDailyCode(tx, "millingBatch", args.companyId, "B");
    const batch = await tx.millingBatch.create({ data: { companyId: args.companyId, code, orderId: args.orderId ?? null, shiftId: args.shiftId ?? null, createdById: args.userId } });
    await audit(tx, args.companyId, args.userId, batch.id, "started", { code });
    return batch;
  });
}

/** Maize into the batch from a lot: a production issue, using the order's reservation on that lot first. */
export async function issueMaize(db: PrismaClient, args: { companyId: string; userId: string; batchId: string; lotId: string; stockLocationId: string; quantityKg: number }) {
  return db.$transaction(async (tx) => {
    const batch = await batchOrThrow(tx, args.companyId, args.batchId);
    assertWorking(batch);
    const reservation = batch.orderId
      ? await tx.millingReservation.findFirst({
          where: { companyId: args.companyId, sourceType: ORDER_ENTITY, sourceId: batch.orderId, lotId: args.lotId, stockLocationId: args.stockLocationId, status: "ACTIVE" },
        })
      : null;
    const quantity = D(args.quantityKg);
    const partOfReservation = reservation && reservation.quantity.gt(quantity);
    if (partOfReservation) {
      // Part of the order's reservation used: shrink it by what is issued, keep the rest promised.
      await tx.millingReservation.update({ where: { id: reservation.id }, data: { quantity: reservation.quantity.minus(quantity) } });
      await tx.millingLotBalance.update({
        where: { lotId_stockLocationId: { lotId: args.lotId, stockLocationId: args.stockLocationId } },
        data: { reserved: { decrement: quantity } },
      });
    }
    await issueFromLot(tx, {
      companyId: args.companyId,
      userId: args.userId,
      lotId: args.lotId,
      stockLocationId: args.stockLocationId,
      quantity,
      reason: "PRODUCTION_ISSUE",
      // A reservation the issue covers whole is fulfilled; the rest comes from free stock.
      reservationId: reservation && !partOfReservation ? reservation.id : null,
      sourceType: BATCH_ENTITY,
      sourceId: batch.id,
      reference: batch.code,
    });
    const lot = await tx.millingLot.findUniqueOrThrow({ where: { id: args.lotId }, select: { productId: true } });
    const line = await tx.inventoryItem.findFirst({ where: { productId: lot.productId, site: { companyId: args.companyId } }, select: { unitCost: true } });
    await tx.millingBatchSourceLot.create({ data: { batchId: batch.id, lotId: args.lotId, stockLocationId: args.stockLocationId, quantityKg: quantity } });
    return tx.millingBatch.update({
      where: { id: batch.id },
      data: {
        status: "IN_PROGRESS",
        maizeIssuedKg: { increment: quantity },
        maizeCost: { increment: line?.unitCost ? line.unitCost.times(quantity).toDecimalPlaces(2) : 0 },
      },
    });
  });
}

export interface StageInput {
  stageId: string;
  shiftId?: string | null;
  equipmentCodes?: string[];
  startedAt: string;
  endedAt?: string | null;
  inputKg?: number | null;
  inputEstimated?: boolean;
  removedKg?: number | null;
  removedEstimated?: boolean;
  waterLitres?: number | null;
  moistureBeforePct?: number | null;
  moistureAfterPct?: number | null;
  observations?: string | null;
  abnormal?: boolean;
}

export async function recordStage(db: PrismaClient, args: { companyId: string; userId: string; batchId: string; input: StageInput }) {
  const { input } = args;
  return db.$transaction(async (tx) => {
    const batch = await batchOrThrow(tx, args.companyId, args.batchId);
    assertWorking(batch);
    const stage = await tx.millingProcessStage.findFirst({ where: { id: input.stageId, companyId: args.companyId, isActive: true } });
    if (!stage) throw millRefusal("That stage is not on the mill's route.");
    const equipmentCodes = input.equipmentCodes?.length ? input.equipmentCodes : stage.equipmentCodes;
    await assertAvailable(tx, args.companyId, equipmentCodes);
    const startedAt = new Date(input.startedAt);
    const endedAt = input.endedAt ? new Date(input.endedAt) : null;
    if (endedAt && endedAt < startedAt) throw millRefusal("A stage ends after it starts.");
    for (const [label, value] of [["Input", input.inputKg], ["Removed", input.removedKg], ["Water", input.waterLitres]] as const) {
      if (value !== null && value !== undefined && value < 0) throw millRefusal(`${label} cannot be below nothing.`);
    }
    if (!stage.capturesQuantities && (input.inputKg || input.removedKg)) throw millRefusal(`${stage.name} records time and downtime only.`);
    const record = await tx.millingStageRecord.create({
      data: {
        batchId: batch.id,
        stageId: stage.id,
        stageCode: stage.code,
        shiftId: input.shiftId ?? batch.shiftId,
        equipmentCodes,
        operatorId: args.userId,
        startedAt,
        endedAt,
        inputKg: input.inputKg ?? null,
        inputEstimated: input.inputEstimated ?? true,
        removedKg: input.removedKg ?? null,
        removedEstimated: input.removedEstimated ?? true,
        waterLitres: input.waterLitres ?? null,
        moistureBeforePct: input.moistureBeforePct ?? null,
        moistureAfterPct: input.moistureAfterPct ?? null,
        observations: input.observations ?? null,
        abnormal: input.abnormal ?? false,
      },
    });
    await tx.millingBatch.update({
      where: { id: batch.id },
      data: { status: "IN_PROGRESS", ...(input.waterLitres ? { waterAddedKg: { increment: input.waterLitres } } : {}) },
    });
    if (input.abnormal) await audit(tx, args.companyId, args.userId, batch.id, "abnormal", { stage: stage.code, observations: input.observations ?? null });
    return record;
  });
}

/** Bulk product out of the batch, into its lot on hold: one lot per product per batch. */
export async function recordOutput(
  db: PrismaClient,
  args: { companyId: string; userId: string; batchId: string; productId: string; stockLocationId: string; quantityKg: number; isEstimated?: boolean },
) {
  return db.$transaction(async (tx) => {
    const batch = await batchOrThrow(tx, args.companyId, args.batchId);
    assertWorking(batch);
    const product = await tx.product.findFirst({ where: { id: args.productId, companyId: args.companyId }, select: { id: true, code: true, unit: true } });
    if (!product) throw millRefusal("That product is not in this workspace.");
    if (product.unit !== "KILOGRAM") throw millRefusal("A batch makes bulk product, in kg. Bags are made at packing.");
    const code = `${batch.code}-${product.code ?? "OUT"}`;
    const lot =
      (await tx.millingLot.findFirst({ where: { companyId: args.companyId, code } })) ??
      (await createLot(tx, { companyId: args.companyId, code, productId: product.id, status: "HOLD", originType: "BATCH", originId: batch.id }));
    await receiveIntoLot(tx, {
      companyId: args.companyId,
      userId: args.userId,
      lotId: lot.id,
      stockLocationId: args.stockLocationId,
      quantity: args.quantityKg,
      reason: "PRODUCTION_OUTPUT",
      sourceType: BATCH_ENTITY,
      sourceId: batch.id,
      reference: batch.code,
      isEstimated: args.isEstimated ?? false,
      unitCost: undefined,
    });
    return tx.millingBatchOutput.create({
      data: { batchId: batch.id, productId: product.id, lotId: lot.id, stockLocationId: args.stockLocationId, quantityKg: args.quantityKg, isEstimated: args.isEstimated ?? false },
    });
  });
}

/**
 * Complete a batch: every required stage recorded, the balance worked out.
 * Out of tolerance, an exception is raised and the batch waits; once
 * management accepts the variance, completing again finishes it.
 */
export async function completeBatch(db: PrismaClient, args: { companyId: string; userId: string; batchId: string; inProcessChangeKg?: number | null }) {
  return db.$transaction(async (tx) => {
    const batch = await batchOrThrow(tx, args.companyId, args.batchId);
    if (batch.status === "COMPLETED") throw millRefusal(`${batch.code} is already complete.`);
    await assertNotBlocked(tx, { companyId: args.companyId, targetType: BATCH_ENTITY, targetId: batch.id });
    if (batch.maizeIssuedKg.lte(0)) throw millRefusal("No maize was issued to this batch.");
    if (!batch.outputs.length) throw millRefusal("Record what the batch made before completing it.");
    const required = await tx.millingProcessStage.findMany({ where: { companyId: args.companyId, isActive: true, required: true } });
    const missing = required.filter((stage) => !batch.stages.some((record) => record.stageId === stage.id));
    if (missing.length) throw millRefusal(`Record these stages first: ${missing.map((stage) => stage.name).join(", ")}.`);

    const outputKg = batch.outputs.reduce((sum, row) => sum.plus(row.quantityKg), D(0));
    const separatedKg = batch.stages.reduce((sum, row) => sum.plus(row.removedKg ?? 0), D(0));
    const change = args.inProcessChangeKg ?? (batch.inProcessChangeKg ? Number(batch.inProcessChangeKg) : 0);
    const balance = materialBalance({ maizeKg: batch.maizeIssuedKg, waterKg: batch.waterAddedKg, outputKg, separatedKg, inProcessChangeKg: change });
    const yields: Record<string, number> = {};
    const products = await tx.product.findMany({ where: { id: { in: batch.outputs.map((row) => row.productId) } }, select: { id: true, code: true } });
    for (const output of batch.outputs) {
      const code = products.find((product) => product.id === output.productId)?.code ?? output.productId;
      yields[code] = (yields[code] ?? 0) + Number(output.quantityKg.div(batch.maizeIssuedKg).times(100).toDecimalPlaces(2));
    }
    const figures = {
      inProcessChangeKg: balance.inProcessChangeKg,
      outputKg: balance.outputKg,
      separatedKg: balance.separatedKg,
      unaccountedKg: balance.unaccountedKg,
      variancePct: balance.variancePct,
      yields,
    };

    const settings = await tx.millingSettings.findUnique({ where: { companyId: args.companyId } });
    const tolerance = D(settings?.reconciliationTolerancePct ?? 2);
    const accepted = await tx.millingException.findFirst({
      where: { companyId: args.companyId, targetType: BATCH_ENTITY, targetId: batch.id, type: "RECONCILIATION_VARIANCE", status: "DECIDED", decision: "ACCEPT_VARIANCE" },
    });
    if (balance.variancePct.gt(tolerance) && !accepted) {
      await raiseException(tx, {
        companyId: args.companyId,
        raisedById: args.userId,
        type: "RECONCILIATION_VARIANCE",
        targetType: BATCH_ENTITY,
        targetId: batch.id,
        title: `${batch.code}: ${balance.unaccountedKg.toFixed(0)} kg unaccounted (${balance.variancePct.toFixed(1)}%, tolerance ${tolerance.toString()}%)`,
        detail: `In ${balance.inKg.toFixed(0)} kg (maize and water); products ${balance.outputKg.toFixed(0)} kg; separated ${balance.separatedKg.toFixed(0)} kg; change in process ${balance.inProcessChangeKg.toFixed(0)} kg.`,
        allowedDecisions: ["ACCEPT_VARIANCE", "RECOUNT"],
        severity: "HIGH",
      });
      const waiting = await tx.millingBatch.update({ where: { id: batch.id }, data: { status: "AWAITING_DECISION", ...figures } });
      await audit(tx, args.companyId, args.userId, batch.id, "out-of-tolerance", { variancePct: balance.variancePct.toString() });
      return waiting;
    }
    const done = await tx.millingBatch.update({ where: { id: batch.id }, data: { status: "COMPLETED", completedAt: new Date(), completedById: args.userId, ...figures } });
    await audit(tx, args.companyId, args.userId, batch.id, "completed", { variancePct: balance.variancePct.toString(), yields });
    if (batch.orderId) {
      const open = await tx.millingBatch.count({ where: { orderId: batch.orderId, status: { not: "COMPLETED" } } });
      if (!open) await tx.millingProductionOrder.updateMany({ where: { id: batch.orderId, status: "IN_PROGRESS" }, data: { status: "COMPLETED" } });
    }
    return done;
  });
}

/** Management's decision on a variance: accept it (the batch can complete) or send it back to be recounted. */
export async function settleVarianceIn(tx: Tx, args: { companyId: string; batchId: string; decision: string }) {
  const batch = await tx.millingBatch.findFirst({ where: { id: args.batchId, companyId: args.companyId } });
  if (!batch || batch.status !== "AWAITING_DECISION") return;
  await tx.millingBatch.update({ where: { id: batch.id }, data: { status: "IN_PROGRESS" } });
}
