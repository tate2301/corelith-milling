import { NotificationSeverity, type PrismaClient } from "@prisma/client";

import { emitRetailNotification } from "@/lib/notifications";

import { MILL_GROUPS, type MillCapability } from "./access/groups";
import { EXCEPTION_TYPES } from "./exceptions/exceptions";

/**
 * Telling the next person (DECISIONS.md, D12). Each step that hands work on
 * notifies the people whose groups do the next step: a delivery waiting for
 * QC tells quality, a plan to approve tells management, a truck dispatched
 * tells its driver. Exceptions tell whoever decides them.
 *
 * Core's notification types are a fixed list with no slot for an extension,
 * so the mill's go out as operations notices, each carrying the mill page
 * that opens it. Sending never fails the step that caused it.
 */

const EVERYTHING = new Set(["SUPERADMIN", "MANAGER"]);

/** Everyone who holds a capability at the mill: owners and managers, and members of the groups that grant it. */
export async function holdersOf(db: PrismaClient, companyId: string, capability: MillCapability): Promise<string[]> {
  const groups = MILL_GROUPS.filter((group) => group.capabilities.includes(capability)).map((group) => group.code);
  const [members, bosses] = await Promise.all([
    db.millingGroupMember.findMany({ where: { companyId, groupCode: { in: groups } }, select: { userId: true } }),
    db.user.findMany({ where: { companyId, isActive: true, role: { in: [...EVERYTHING] as never } }, select: { id: true } }),
  ]);
  const active = await db.user.findMany({ where: { companyId, isActive: true, id: { in: members.map((row) => row.userId) } }, select: { id: true } });
  return [...new Set([...active.map((row) => row.id), ...bosses.map((row) => row.id)])];
}

export async function notifyMill(
  db: PrismaClient,
  args: {
    companyId: string;
    /** Who to tell: everyone with this capability, or these people. */
    to: MillCapability | string[];
    /** The person who did it: not told about their own work. */
    actorId?: string | null;
    title: string;
    summary: string;
    viewPath: string;
    entityId: string;
    severity?: NotificationSeverity;
    /**
     * Work handed to the reader, for their Needs you. Core's generic emitter
     * cannot carry it yet; tate2301/huchu#261 adds one that can, and this
     * switches to it after that release is synced.
     */
    needsYou?: boolean;
  },
) {
  try {
    const recipients = (typeof args.to === "string" ? await holdersOf(db, args.companyId, args.to) : args.to).filter((id) => id && id !== args.actorId);
    if (!recipients.length) return;
    await emitRetailNotification({
      companyId: args.companyId,
      recipientIds: recipients,
      type: "OPS_INCIDENT_CREATED",
      title: args.title,
      summary: args.summary,
      entityType: "INCIDENT",
      entityId: args.entityId,
      viewPath: args.viewPath,
      severity: args.severity ?? NotificationSeverity.INFO,
    });
  } catch (error) {
    console.error("[milling] notification failed:", error);
  }
}

/**
 * Tell the deciders about every exception not yet announced, wherever it was
 * raised. Run after each mill write (`millRoute`), so no service has to
 * remember to.
 */
export async function announceExceptions(db: PrismaClient, companyId: string) {
  const fresh = await db.millingException.findMany({ where: { companyId, notifiedAt: null }, orderBy: { createdAt: "asc" }, take: 20 });
  for (const exception of fresh) {
    const claimed = await db.millingException.updateMany({ where: { id: exception.id, notifiedAt: null }, data: { notifiedAt: new Date() } });
    if (!claimed.count) continue;
    if (exception.status !== "OPEN") continue;
    await notifyMill(db, {
      companyId,
      to: "exception.decide",
      actorId: exception.raisedById,
      title: `${EXCEPTION_TYPES[exception.type as keyof typeof EXCEPTION_TYPES] ?? "Exception"}: ${exception.code}`,
      summary: exception.title,
      viewPath: "/milling/exceptions",
      entityId: exception.id,
      severity: exception.severity === "HIGH" ? NotificationSeverity.CRITICAL : NotificationSeverity.WARNING,
    });
  }
}
