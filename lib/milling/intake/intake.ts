import { Prisma, type PrismaClient } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";

import { recordAmendment } from "../records/amend";
import { nextDailyCode } from "../records/codes";
import { recordInspection, type QcResultInput } from "../quality/inspect";
import { assertReleasable } from "../quality/release";
import { adjustLotTo, createLot, issueFromLot, receiveIntoLot, setLotStatus } from "../stock/ledger";

/**
 * Maize intake (plan v2, 3.5): a delivery is weighed one of three ways, QC
 * inspects it, and the quality officer accepts, holds or rejects it.
 *
 * - **Accepted:** an AVAILABLE lot in the chosen bin.
 * - **Held:** the maize is on site, so it is received too, into a lot on HOLD
 *   that nothing can use until it is released.
 * - **Rejected:** nothing is kept; a held lot goes back to the supplier.
 *
 * A bag-count or supplier weight stays PROVISIONAL until a weighbridge ticket
 * confirms it. The confirmation is an amendment that keeps the first figure,
 * and the lot is adjusted by the difference.
 */

type Tx = Prisma.TransactionClient;
export const INTAKE_ENTITY = "MillingIntake";

export type WeighMethod = "BAG_COUNT" | "EXTERNAL_TICKET" | "SUPPLIER_DECLARED";

export class IntakeError extends Error {}

export interface NewIntake {
  productId: string;
  supplierId?: string | null;
  supplierName: string;
  deliveryRef?: string | null;
  vehicleReg?: string | null;
  driverName?: string | null;
  variety?: string | null;
  weighMethod: WeighMethod;
  bags?: number | null;
  bagKg?: number | null;
  grossKg?: number | null;
  tareKg?: number | null;
  netKg?: number | null;
  ticketNumber?: string | null;
  ticketFileUrl?: string | null;
  binLocationId?: string | null;
  notes?: string | null;
}

/** The net weight and its status, from the method used. */
export function weighIntake(input: Pick<NewIntake, "weighMethod" | "bags" | "bagKg" | "grossKg" | "tareKg" | "netKg" | "ticketNumber">, defaultBagKg: number) {
  const positive = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) && value > 0;
  switch (input.weighMethod) {
    case "BAG_COUNT": {
      if (!positive(input.bags) || !Number.isInteger(input.bags)) throw new IntakeError("Enter how many bags were delivered.");
      const bagKg = positive(input.bagKg) ? input.bagKg! : defaultBagKg;
      return { bags: input.bags!, bagKg, netKg: input.bags! * bagKg, weightStatus: "PROVISIONAL" as const };
    }
    case "EXTERNAL_TICKET": {
      if (!input.ticketNumber?.trim()) throw new IntakeError("Enter the weighbridge ticket number.");
      if (positive(input.grossKg) && positive(input.tareKg)) {
        if (input.tareKg! >= input.grossKg!) throw new IntakeError("Tare must be less than gross.");
        return { grossKg: input.grossKg!, tareKg: input.tareKg!, netKg: input.grossKg! - input.tareKg!, weightStatus: "VERIFIED" as const };
      }
      if (!positive(input.netKg)) throw new IntakeError("Enter the ticket's gross and tare, or its net weight.");
      return { netKg: input.netKg!, weightStatus: "VERIFIED" as const };
    }
    case "SUPPLIER_DECLARED": {
      if (!positive(input.netKg)) throw new IntakeError("Enter the weight the supplier declared.");
      return { netKg: input.netKg!, weightStatus: "PROVISIONAL" as const };
    }
  }
}

async function intakeOrThrow(tx: Tx, companyId: string, intakeId: string) {
  await tx.$queryRaw`SELECT "id" FROM "MillingIntake" WHERE "id" = ${intakeId} FOR UPDATE`;
  const intake = await tx.millingIntake.findFirst({ where: { id: intakeId, companyId } });
  if (!intake) throw new IntakeError("That intake is not in this workspace.");
  return intake;
}

async function audit(tx: Tx, companyId: string, actorId: string, intakeId: string, action: string, payload?: Record<string, unknown>, reason?: string) {
  await writePlatformAuditEvent(
    { companyId, actorId, eventType: `milling.intake.${action}`, entityType: INTAKE_ENTITY, entityId: intakeId, payload, reason },
    tx,
  );
}

export async function recordIntake(db: PrismaClient, args: { companyId: string; userId: string; input: NewIntake }) {
  const { input } = args;
  if (!input.supplierName?.trim()) throw new IntakeError("Who delivered it?");
  return db.$transaction(async (tx) => {
    const product = await tx.product.findFirst({ where: { id: input.productId, companyId: args.companyId }, select: { id: true } });
    if (!product) throw new IntakeError("That product is not in this workspace.");
    if (input.supplierId) {
      const vendor = await tx.vendor.findFirst({ where: { id: input.supplierId, companyId: args.companyId }, select: { id: true } });
      if (!vendor) throw new IntakeError("That supplier is not in this workspace.");
    }
    if (input.binLocationId) {
      const bin = await tx.stockLocation.findFirst({ where: { id: input.binLocationId, site: { companyId: args.companyId } }, select: { id: true } });
      if (!bin) throw new IntakeError("That location is not at the mill.");
    }
    const settings = await tx.millingSettings.findUnique({ where: { companyId: args.companyId } });
    const weight = weighIntake(input, Number(settings?.defaultIntakeBagKg ?? 50));
    const code = await nextDailyCode(tx, "millingIntake", args.companyId, "MI");
    const intake = await tx.millingIntake.create({
      data: {
        companyId: args.companyId,
        code,
        productId: input.productId,
        supplierId: input.supplierId ?? null,
        supplierName: input.supplierName.trim(),
        deliveryRef: input.deliveryRef ?? null,
        vehicleReg: input.vehicleReg ?? null,
        driverName: input.driverName ?? null,
        variety: input.variety ?? null,
        weighMethod: input.weighMethod,
        ticketNumber: input.ticketNumber ?? null,
        ticketFileUrl: input.ticketFileUrl ?? null,
        binLocationId: input.binLocationId ?? null,
        notes: input.notes ?? null,
        receivedById: args.userId,
        ...weight,
      },
    });
    await audit(tx, args.companyId, args.userId, intake.id, "received", { code, netKg: weight.netKg, weightStatus: weight.weightStatus });
    return intake;
  });
}

export async function inspectIntake(
  db: PrismaClient,
  args: { companyId: string; userId: string; intakeId: string; results: QcResultInput[]; notes?: string | null },
) {
  return db.$transaction(async (tx) => {
    const intake = await intakeOrThrow(tx, args.companyId, args.intakeId);
    if (!["AWAITING_QC", "HELD"].includes(intake.status)) throw new IntakeError(`${intake.code} is ${intake.status.toLowerCase()}; it is not inspected again.`);
    const inspection = await recordInspection(tx, {
      companyId: args.companyId,
      userId: args.userId,
      point: "INCOMING_MAIZE",
      targetType: INTAKE_ENTITY,
      targetId: intake.id,
      targetLabel: intake.code,
      results: args.results,
      notes: args.notes,
    });
    const moisture = inspection.results.find((result) => result.specCode === "MOISTURE")?.value;
    if (intake.lotId && moisture) {
      await tx.millingLot.update({ where: { id: intake.lotId }, data: { attributes: { moisturePct: Number(moisture), variety: intake.variety } } });
    }
    return inspection;
  });
}

export type IntakeDecision = "ACCEPT" | "HOLD" | "REJECT";

/** Receive the delivery into its lot, once: a held intake already has one. */
async function ensureReceived(tx: Tx, args: { companyId: string; userId: string; intake: Awaited<ReturnType<typeof intakeOrThrow>>; binLocationId: string; status: "AVAILABLE" | "HOLD" }) {
  const { intake } = args;
  if (intake.lotId) return intake.lotId;
  const inspection = await tx.millingQcInspection.findFirst({
    where: { companyId: args.companyId, targetType: INTAKE_ENTITY, targetId: intake.id },
    orderBy: { inspectedAt: "desc" },
    include: { results: true },
  });
  const moisture = inspection?.results.find((result) => result.specCode === "MOISTURE")?.value;
  const lot = await createLot(tx, {
    companyId: args.companyId,
    code: intake.code.replace(/^MI-/, "M-"),
    productId: intake.productId,
    status: args.status,
    originType: "INTAKE",
    originId: intake.id,
    attributes: { variety: intake.variety, moisturePct: moisture ? Number(moisture) : null, supplier: intake.supplierName },
    producedAt: intake.receivedAt,
  });
  await receiveIntoLot(tx, {
    companyId: args.companyId,
    userId: args.userId,
    lotId: lot.id,
    stockLocationId: args.binLocationId,
    quantity: intake.netKg,
    reason: "INTAKE_RECEIPT",
    sourceType: INTAKE_ENTITY,
    sourceId: intake.id,
    reference: intake.code,
    isEstimated: intake.weightStatus === "PROVISIONAL",
  });
  return lot.id;
}

export type DecideIntakeArgs = { companyId: string; userId: string; intakeId: string; decision: IntakeDecision; binLocationId?: string | null; note?: string | null };

export async function decideIntake(db: PrismaClient, args: DecideIntakeArgs) {
  return db.$transaction((tx) => decideIntakeIn(tx, args));
}

/** The decision inside a caller's transaction: an exception's decision applies it with its own. */
export async function decideIntakeIn(tx: Tx, args: DecideIntakeArgs) {
  {
    const intake = await intakeOrThrow(tx, args.companyId, args.intakeId);
    const open = ["AWAITING_QC", "HELD"];
    if (!open.includes(intake.status)) throw new IntakeError(`${intake.code} is already ${intake.status.toLowerCase()}.`);
    const binLocationId = args.binLocationId ?? intake.binLocationId;
    const decided = { decidedById: args.userId, decidedAt: new Date(), decisionNote: args.note ?? null };

    if (args.decision === "REJECT") {
      if (intake.lotId) {
        const balances = await tx.millingLotBalance.findMany({ where: { lotId: intake.lotId, quantity: { gt: 0 } } });
        for (const balance of balances) {
          await issueFromLot(tx, {
            companyId: args.companyId,
            userId: args.userId,
            lotId: intake.lotId,
            stockLocationId: balance.stockLocationId,
            quantity: balance.quantity.minus(balance.reserved),
            reason: "RETURN_TO_SUPPLIER",
            sourceType: INTAKE_ENTITY,
            sourceId: intake.id,
            reference: intake.code,
          });
        }
        await tx.millingLot.update({ where: { id: intake.lotId }, data: { status: "REJECTED" } });
      }
      const updated = await tx.millingIntake.update({ where: { id: intake.id }, data: { status: "REJECTED", ...decided } });
      await audit(tx, args.companyId, args.userId, intake.id, "rejected", undefined, args.note ?? undefined);
      return updated;
    }

    if (!binLocationId) throw new IntakeError("Choose the bin or store it goes into.");

    if (args.decision === "HOLD") {
      const lotId = await ensureReceived(tx, { companyId: args.companyId, userId: args.userId, intake, binLocationId, status: "HOLD" });
      const updated = await tx.millingIntake.update({ where: { id: intake.id }, data: { status: "HELD", lotId, binLocationId, ...decided } });
      await audit(tx, args.companyId, args.userId, intake.id, "held", undefined, args.note ?? undefined);
      return updated;
    }

    const { overridden } = await assertReleasable(tx, { companyId: args.companyId, targetType: INTAKE_ENTITY, targetId: intake.id });
    const lotId = await ensureReceived(tx, { companyId: args.companyId, userId: args.userId, intake, binLocationId, status: "AVAILABLE" });
    await setLotStatus(tx, { companyId: args.companyId, lotId, status: "AVAILABLE" });
    const updated = await tx.millingIntake.update({ where: { id: intake.id }, data: { status: "ACCEPTED", lotId, binLocationId, ...decided } });
    await audit(tx, args.companyId, args.userId, intake.id, "accepted", { overridden }, args.note ?? undefined);
    return updated;
  }
}

/** A provisional weight confirmed by a weighbridge ticket: an amendment, and the lot adjusted by the difference. */
export async function confirmIntakeWeight(
  db: PrismaClient,
  args: { companyId: string; userId: string; intakeId: string; ticketNumber: string; grossKg?: number | null; tareKg?: number | null; netKg?: number | null; ticketFileUrl?: string | null; reason: string },
) {
  return db.$transaction(async (tx) => {
    const intake = await intakeOrThrow(tx, args.companyId, args.intakeId);
    if (intake.status === "REJECTED" || intake.status === "CANCELLED") throw new IntakeError(`${intake.code} is ${intake.status.toLowerCase()}.`);
    if (intake.weightStatus === "VERIFIED") throw new IntakeError(`${intake.code}'s weight is already verified.`);
    const weight = weighIntake({ weighMethod: "EXTERNAL_TICKET", ticketNumber: args.ticketNumber, grossKg: args.grossKg, tareKg: args.tareKg, netKg: args.netKg }, 50);
    const next = {
      netKg: new Prisma.Decimal(weight.netKg),
      grossKg: "grossKg" in weight && weight.grossKg !== undefined ? new Prisma.Decimal(weight.grossKg) : null,
      tareKg: "tareKg" in weight && weight.tareKg !== undefined ? new Prisma.Decimal(weight.tareKg) : null,
      ticketNumber: args.ticketNumber.trim(),
      ticketFileUrl: args.ticketFileUrl ?? intake.ticketFileUrl,
      weightStatus: "VERIFIED",
    };
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [field, to] of Object.entries(next)) {
      const from = (intake as Record<string, unknown>)[field];
      if (String(from ?? "") !== String(to ?? "")) changes[field] = { from, to };
    }
    await recordAmendment(tx, { companyId: args.companyId, actorId: args.userId, entityType: INTAKE_ENTITY, entityId: intake.id, changes, reason: args.reason });

    const delta = next.netKg.minus(intake.netKg);
    if (intake.lotId && intake.binLocationId && !delta.isZero()) {
      const balance = await tx.millingLotBalance.findUnique({
        where: { lotId_stockLocationId: { lotId: intake.lotId, stockLocationId: intake.binLocationId } },
      });
      const target = (balance?.quantity ?? new Prisma.Decimal(0)).plus(delta);
      if (target.lt(0)) throw new IntakeError("The lot has already been used past the confirmed weight; correct it with a count instead.");
      await adjustLotTo(tx, {
        companyId: args.companyId,
        userId: args.userId,
        lotId: intake.lotId,
        stockLocationId: intake.binLocationId,
        quantity: target,
        reason: "WEIGHT_CORRECTION",
        sourceType: INTAKE_ENTITY,
        sourceId: intake.id,
        reference: intake.code,
      });
    }
    return tx.millingIntake.update({ where: { id: intake.id }, data: next });
  });
}

export async function cancelIntake(db: PrismaClient, args: { companyId: string; userId: string; intakeId: string; reason: string }) {
  return db.$transaction(async (tx) => {
    const intake = await intakeOrThrow(tx, args.companyId, args.intakeId);
    if (intake.status !== "AWAITING_QC") throw new IntakeError("Only an intake still awaiting QC can be cancelled.");
    if (args.reason.trim().length < 3) throw new IntakeError("Say why it is cancelled.");
    const updated = await tx.millingIntake.update({ where: { id: intake.id }, data: { status: "CANCELLED", decisionNote: args.reason } });
    await audit(tx, args.companyId, args.userId, intake.id, "cancelled", undefined, args.reason);
    return updated;
  });
}
