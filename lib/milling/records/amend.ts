import type { Prisma } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";

/**
 * Corrections that keep the original (DECISIONS.md, D8).
 *
 * A record that has left draft is never edited in place. The service that
 * owns it works out what changes and calls `recordAmendment` in the same
 * transaction as its update: each field's old and new value and the reason are
 * kept, and one event goes on the audit chain.
 */

export class AmendmentError extends Error {}

type Tx = Pick<Prisma.TransactionClient, "millingAmendment" | "platformAuditEvent">;

export type FieldChanges = Record<string, { from: unknown; to: unknown }>;

/** The fields that really change: an unchanged value is not an amendment. */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>): FieldChanges {
  const changes: FieldChanges = {};
  for (const [field, to] of Object.entries(after)) {
    if (to === undefined) continue;
    const from = before[field];
    if (JSON.stringify(normalise(from)) !== JSON.stringify(normalise(to))) changes[field] = { from, to };
  }
  return changes;
}

function normalise(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return (value as { toNumber: () => number }).toNumber();
  }
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return value ?? null;
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  const plain = normalise(value);
  return plain === null || plain === undefined ? undefined : (plain as Prisma.InputJsonValue);
}

export async function recordAmendment(
  tx: Tx,
  args: {
    companyId: string;
    actorId: string;
    entityType: string;
    entityId: string;
    changes: FieldChanges;
    reason: string;
  },
): Promise<number> {
  const reason = args.reason.trim();
  if (reason.length < 3) throw new AmendmentError("Say why this is being corrected.");
  const fields = Object.keys(args.changes);
  if (!fields.length) throw new AmendmentError("Nothing has changed.");

  await tx.millingAmendment.createMany({
    data: fields.map((field) => ({
      companyId: args.companyId,
      entityType: args.entityType,
      entityId: args.entityId,
      field,
      oldValue: toJson(args.changes[field].from),
      newValue: toJson(args.changes[field].to),
      reason,
      amendedById: args.actorId,
    })),
  });
  await writePlatformAuditEvent(
    {
      companyId: args.companyId,
      actorId: args.actorId,
      eventType: "milling.record.amended",
      entityType: args.entityType,
      entityId: args.entityId,
      reason,
      payload: { fields },
    },
    tx,
  );
  return fields.length;
}
