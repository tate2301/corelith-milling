import type { Prisma, PrismaClient } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";

import { isMillGroupCode, MILL_GROUP_CODES, type MillGroupCode } from "./groups";

type Db = PrismaClient | Prisma.TransactionClient;

export interface MillMemberRow {
  userId: string;
  name: string;
  email: string | null;
  role: string;
  isActive: boolean;
  groups: MillGroupCode[];
}

/** Everyone in the workspace who can sign in, with their mill groups. */
export async function listMillMembers(db: Db, companyId: string): Promise<MillMemberRow[]> {
  const [users, rows] = await Promise.all([
    db.user.findMany({
      where: { companyId, email: { not: null } },
      select: { id: true, name: true, email: true, role: true, isActive: true },
      orderBy: { name: "asc" },
    }),
    db.millingGroupMember.findMany({ where: { companyId }, select: { userId: true, groupCode: true } }),
  ]);
  const byUser = new Map<string, MillGroupCode[]>();
  for (const row of rows) {
    if (!isMillGroupCode(row.groupCode)) continue;
    byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row.groupCode]);
  }
  return users.map((user) => ({
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    groups: MILL_GROUP_CODES.filter((code) => byUser.get(user.id)?.includes(code)),
  }));
}

export class MillMembershipError extends Error {}

/**
 * Put a person in exactly these groups: adds the missing ones, removes the
 * rest, and records the change on the audit chain. Refuses a person from
 * another workspace.
 */
export async function setMillGroups(
  db: PrismaClient,
  args: { companyId: string; actorId: string; userId: string; groups: string[] },
): Promise<MillGroupCode[]> {
  const unknown = args.groups.filter((code) => !isMillGroupCode(code));
  if (unknown.length) throw new MillMembershipError(`Unknown group: ${unknown.join(", ")}`);
  const wanted = MILL_GROUP_CODES.filter((code) => args.groups.includes(code));

  return db.$transaction(async (tx) => {
    const user = await tx.user.findFirst({ where: { id: args.userId, companyId: args.companyId }, select: { id: true } });
    if (!user) throw new MillMembershipError("That person is not in this workspace.");

    const current = await tx.millingGroupMember.findMany({
      where: { userId: args.userId, companyId: args.companyId },
      select: { groupCode: true },
    });
    const before = current.map((row) => row.groupCode);
    const added = wanted.filter((code) => !before.includes(code));
    const removed = before.filter((code) => !(wanted as string[]).includes(code));
    if (!added.length && !removed.length) return wanted;

    if (removed.length) {
      await tx.millingGroupMember.deleteMany({
        where: { userId: args.userId, companyId: args.companyId, groupCode: { in: removed } },
      });
    }
    if (added.length) {
      await tx.millingGroupMember.createMany({
        data: added.map((groupCode) => ({
          companyId: args.companyId,
          userId: args.userId,
          groupCode,
          createdById: args.actorId,
        })),
      });
    }
    await writePlatformAuditEvent(
      {
        companyId: args.companyId,
        actorId: args.actorId,
        eventType: "milling.groups.changed",
        entityType: "User",
        entityId: args.userId,
        payload: { added, removed },
      },
      tx,
    );
    return wanted;
  });
}
