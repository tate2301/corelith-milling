import type { PrismaClient } from "@prisma/client";

export interface HistoryEntry {
  at: string;
  who: string | null;
  kind: "event" | "amendment";
  /** e.g. "milling.intake.approved", or the amended field. */
  what: string;
  reason: string | null;
  from?: unknown;
  to?: unknown;
}

/** A mill record's History tab: its audit events and its amendments, newest first, with names. */
export async function recordHistory(
  db: PrismaClient,
  args: { companyId: string; entityType: string; entityId: string },
): Promise<HistoryEntry[]> {
  const [events, amendments] = await Promise.all([
    db.platformAuditEvent.findMany({
      where: { companyId: args.companyId, entityType: args.entityType, entityId: args.entityId },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.millingAmendment.findMany({
      where: { companyId: args.companyId, entityType: args.entityType, entityId: args.entityId },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);
  const ids = [...new Set([...events.map((event) => event.actor), ...amendments.map((row) => row.amendedById)])].filter(
    (id): id is string => Boolean(id),
  );
  const users = await db.user.findMany({ where: { id: { in: ids }, companyId: args.companyId }, select: { id: true, name: true } });
  const name = (id: string | null) => (id ? users.find((user) => user.id === id)?.name ?? null : null);

  const entries: HistoryEntry[] = [
    ...events
      .filter((event) => event.eventType !== "milling.record.amended")
      .map((event) => ({
        at: event.createdAt.toISOString(),
        who: name(event.actor),
        kind: "event" as const,
        what: event.eventType,
        reason: event.reason,
      })),
    ...amendments.map((row) => ({
      at: row.createdAt.toISOString(),
      who: name(row.amendedById),
      kind: "amendment" as const,
      what: row.field,
      reason: row.reason,
      from: row.oldValue,
      to: row.newValue,
    })),
  ];
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}
