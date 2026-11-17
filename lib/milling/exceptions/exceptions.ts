import type { Prisma } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";

import { nextDailyCode } from "../records/codes";

/**
 * Exceptions with authorised decisions (plan F4).
 *
 * A quality failure, a breakdown or a stock difference raises one against
 * the record it is about. A blocking exception stops that record's next step
 * until someone allowed to decide (`exception.decide`) chooses one of the
 * decisions it allows. The services check this themselves, so a screen that
 * forgets cannot get round it.
 */

type Tx = Prisma.TransactionClient;

export const EXCEPTION_TYPES = {
  QC_FAIL: "Quality check failed",
  QC_NOT_PERFORMED: "Required check not performed",
  BREAKDOWN: "Breakdown",
  STOCK_DISCREPANCY: "Stock count difference",
  RECONCILIATION_VARIANCE: "Material balance out of tolerance",
  OVER_CAPACITY: "Load over vehicle capacity",
  DELIVERY_SHORTAGE: "Delivery short",
  DAMAGE: "Damaged stock",
} as const;

export type ExceptionType = keyof typeof EXCEPTION_TYPES;

export class ExceptionError extends Error {}

export async function raiseException(
  tx: Tx,
  args: {
    companyId: string;
    raisedById: string | null;
    type: ExceptionType;
    targetType: string;
    targetId: string;
    title: string;
    detail?: string;
    allowedDecisions: string[];
    severity?: "LOW" | "MEDIUM" | "HIGH";
    blocking?: boolean;
  },
) {
  if (!args.allowedDecisions.length) throw new ExceptionError("An exception needs at least one decision to choose from.");
  const code = await nextDailyCode(tx, "millingException", args.companyId, "EX");
  const exception = await tx.millingException.create({
    data: {
      companyId: args.companyId,
      code,
      type: args.type,
      severity: args.severity ?? "MEDIUM",
      blocking: args.blocking ?? true,
      targetType: args.targetType,
      targetId: args.targetId,
      title: args.title,
      detail: args.detail,
      allowedDecisions: args.allowedDecisions,
      raisedById: args.raisedById,
    },
  });
  await writePlatformAuditEvent(
    {
      companyId: args.companyId,
      actorId: args.raisedById,
      eventType: "milling.exception.raised",
      entityType: args.targetType,
      entityId: args.targetId,
      payload: { code, type: args.type, title: args.title },
    },
    tx,
  );
  return exception;
}

/** Open blocking exceptions on a record. */
export function openBlocking(tx: Tx, args: { companyId: string; targetType: string; targetId: string }) {
  return tx.millingException.findMany({
    where: { ...args, status: "OPEN", blocking: true },
    orderBy: { createdAt: "asc" },
  });
}

/** Refuse a record's next step while a blocking exception on it is open. */
export async function assertNotBlocked(tx: Tx, args: { companyId: string; targetType: string; targetId: string }) {
  const open = await openBlocking(tx, args);
  if (open.length) {
    throw new ExceptionError(`Waiting on a decision: ${open.map((exception) => `${exception.code} ${exception.title}`).join("; ")}.`);
  }
}

/** The latest decision taken on a record's exceptions of a type, if any. */
export async function latestDecision(
  tx: Tx,
  args: { companyId: string; targetType: string; targetId: string; type: ExceptionType },
) {
  return tx.millingException.findFirst({
    where: { ...args, status: "DECIDED" },
    orderBy: { decidedAt: "desc" },
  });
}

export async function decideException(
  tx: Tx,
  args: { companyId: string; deciderId: string; exceptionId: string; decision: string; note: string },
) {
  await tx.$queryRaw`SELECT "id" FROM "MillingException" WHERE "id" = ${args.exceptionId} FOR UPDATE`;
  const exception = await tx.millingException.findFirst({ where: { id: args.exceptionId, companyId: args.companyId } });
  if (!exception) throw new ExceptionError("That exception is not in this workspace.");
  if (exception.status !== "OPEN") throw new ExceptionError(`${exception.code} was already decided: ${exception.decision}.`);
  if (!exception.allowedDecisions.includes(args.decision)) {
    throw new ExceptionError(`Choose one of: ${exception.allowedDecisions.join(", ")}.`);
  }
  const note = args.note.trim();
  if (note.length < 3) throw new ExceptionError("Say why: the decision is kept with the record.");
  const decided = await tx.millingException.update({
    where: { id: exception.id },
    data: { status: "DECIDED", decision: args.decision, decisionNote: note, decidedById: args.deciderId, decidedAt: new Date() },
  });
  await writePlatformAuditEvent(
    {
      companyId: args.companyId,
      actorId: args.deciderId,
      eventType: "milling.exception.decided",
      entityType: exception.targetType,
      entityId: exception.targetId,
      reason: note,
      payload: { code: exception.code, decision: args.decision },
    },
    tx,
  );
  return decided;
}
