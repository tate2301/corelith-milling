import { Prisma } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";

import { raiseException } from "../exceptions/exceptions";

/**
 * QC inspections (plan v2, 3.4). Each result is judged against the check's
 * version in force, and kept with it. Not performed is never a pass: a
 * required check left undone makes the inspection INCOMPLETE, and raises an
 * exception that someone must decide before the stock is released.
 */

type Tx = Prisma.TransactionClient;

export type QcPoint = "INCOMING_MAIZE" | "FINISHED_PRODUCT";
export type QcMethod = "VISUAL" | "INSTRUMENT" | "NOT_PERFORMED";
export type QcOutcome = "PASS" | "FAIL" | "INCOMPLETE";

export interface QcResultInput {
  specId: string;
  method: QcMethod;
  /** A reading, for a check judged against limits. */
  value?: number | string | null;
  /** The inspector's judgement, for a pass-or-fail check. */
  passed?: boolean | null;
  note?: string | null;
}

export class QcError extends Error {}

/** The decisions an exception from a failed or incomplete inspection offers. */
export const QC_DECISIONS = {
  FAIL: ["RELEASE_ANYWAY", "KEEP_ON_HOLD", "REJECT"],
  INCOMPLETE: ["RELEASE_ANYWAY", "KEEP_ON_HOLD", "REJECT"],
} as const;

interface Spec {
  id: string;
  code: string;
  name: string;
  version: number;
  method: string;
  resultType: string;
  minValue: Prisma.Decimal | null;
  maxValue: Prisma.Decimal | null;
  required: boolean;
}

/** Whether one result passes its check. Null: not performed, so neither. */
export function judge(spec: Spec, input: QcResultInput | undefined): { method: QcMethod; value: Prisma.Decimal | null; passed: boolean | null } {
  if (!input || input.method === "NOT_PERFORMED") return { method: "NOT_PERFORMED", value: null, passed: null };
  if (spec.resultType === "NUMERIC") {
    if (input.value === null || input.value === undefined || input.value === "" || Number.isNaN(Number(input.value))) {
      throw new QcError(`${spec.name} needs a reading, or mark it not performed.`);
    }
    const value = new Prisma.Decimal(input.value);
    const passed = (!spec.minValue || value.gte(spec.minValue)) && (!spec.maxValue || value.lte(spec.maxValue));
    return { method: input.method, value, passed };
  }
  if (typeof input.passed !== "boolean") throw new QcError(`Say whether ${spec.name} passed, or mark it not performed.`);
  return { method: input.method, value: null, passed: input.passed };
}

export function outcomeOf(results: Array<{ passed: boolean | null; required: boolean }>): QcOutcome {
  if (results.some((result) => result.passed === false)) return "FAIL";
  if (results.some((result) => result.required && result.passed === null)) return "INCOMPLETE";
  return "PASS";
}

export async function recordInspection(
  tx: Tx,
  args: {
    companyId: string;
    userId: string;
    point: QcPoint;
    targetType: string;
    targetId: string;
    /** For the exception's title, e.g. "MI-261116-01". */
    targetLabel: string;
    results: QcResultInput[];
    notes?: string | null;
  },
) {
  const specs = await tx.millingQcSpec.findMany({
    where: { companyId: args.companyId, point: args.point, isActive: true },
    orderBy: { code: "asc" },
  });
  if (!specs.length) throw new QcError("No checks are set up for this point. Add them at Mill settings › Quality checks.");
  const unknown = args.results.filter((result) => !specs.some((spec) => spec.id === result.specId));
  if (unknown.length) throw new QcError("A result names a check that is not in use here.");

  const judged = specs.map((spec) => {
    const result = judge(spec, args.results.find((entry) => entry.specId === spec.id));
    const note = args.results.find((entry) => entry.specId === spec.id)?.note ?? null;
    return { spec, ...result, note };
  });
  const outcome = outcomeOf(judged.map((entry) => ({ passed: entry.passed, required: entry.spec.required })));

  const inspection = await tx.millingQcInspection.create({
    data: {
      companyId: args.companyId,
      point: args.point,
      targetType: args.targetType,
      targetId: args.targetId,
      inspectedById: args.userId,
      outcome,
      notes: args.notes ?? null,
      results: {
        create: judged.map((entry) => ({
          specId: entry.spec.id,
          specVersion: entry.spec.version,
          specCode: entry.spec.code,
          specName: entry.spec.name,
          method: entry.method,
          value: entry.value,
          passed: entry.passed,
          note: entry.note,
        })),
      },
    },
    include: { results: true },
  });

  await writePlatformAuditEvent(
    {
      companyId: args.companyId,
      actorId: args.userId,
      eventType: "milling.qc.inspected",
      entityType: args.targetType,
      entityId: args.targetId,
      payload: { inspectionId: inspection.id, outcome },
    },
    tx,
  );

  if (outcome !== "PASS") {
    const failed = judged.filter((entry) => entry.passed === false).map((entry) => entry.spec.name);
    const missing = judged.filter((entry) => entry.spec.required && entry.passed === null).map((entry) => entry.spec.name);
    await raiseException(tx, {
      companyId: args.companyId,
      raisedById: args.userId,
      type: outcome === "FAIL" ? "QC_FAIL" : "QC_NOT_PERFORMED",
      targetType: args.targetType,
      targetId: args.targetId,
      title: outcome === "FAIL" ? `${args.targetLabel} failed ${failed.join(", ")}` : `${args.targetLabel}: ${missing.join(", ")} not performed`,
      detail: [failed.length ? `Failed: ${failed.join(", ")}.` : "", missing.length ? `Not performed: ${missing.join(", ")}.` : ""]
        .filter(Boolean)
        .join(" "),
      allowedDecisions: [...QC_DECISIONS[outcome]],
      severity: outcome === "FAIL" ? "HIGH" : "MEDIUM",
    });
  }
  return inspection;
}

/** The latest inspection of a record. */
export function latestInspection(tx: Tx, args: { companyId: string; targetType: string; targetId: string }) {
  return tx.millingQcInspection.findFirst({
    where: args,
    orderBy: { inspectedAt: "desc" },
    include: { results: true },
  });
}
