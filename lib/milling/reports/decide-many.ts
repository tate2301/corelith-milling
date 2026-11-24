import type { PrismaClient } from "@prisma/client";

import { can, type MillAccess } from "../access/groups";
import { isRefusal } from "../api";
import { notifyMill } from "../notify";
import { approveOrder, setOrderStatus } from "../production/orders";
import { approveShift } from "../production/shifts";

/**
 * Approve or send back several records from the Overview at once (HM-A1).
 *
 * Only records whose decision is one press can be chosen: a submitted plan
 * (approve, or send back to draft with a reason) and a closed shift (approve).
 * Runs, intakes, held lots, exceptions and deliveries need figures or a
 * choice made on the record itself, so they open instead.
 *
 * Each record goes through its own service, with its own checks, one at a
 * time: one refused (a plan short of maize) does not stop the others, and
 * each answer comes back for the screen to show.
 */

export type BulkKind = "plan" | "shift";
export type BulkAction = "approve" | "send-back";

/** What can be done to each kind in one press, and who may. */
export const BULK_ACTIONS: Record<BulkKind, { actions: BulkAction[]; capability: "plan.approve" | "shift.approve" }> = {
  plan: { actions: ["approve", "send-back"], capability: "plan.approve" },
  shift: { actions: ["approve"], capability: "shift.approve" },
};

export interface BulkResult {
  kind: BulkKind;
  id: string;
  ok: boolean;
  message: string;
}

export async function decideMany(
  db: PrismaClient,
  args: { companyId: string; userId: string; access: Pick<MillAccess, "capabilities">; action: BulkAction; items: Array<{ kind: BulkKind; id: string }>; reason?: string | null },
): Promise<BulkResult[]> {
  const reason = args.reason?.trim() || null;
  const results: BulkResult[] = [];
  for (const item of args.items) {
    const rule = BULK_ACTIONS[item.kind];
    if (!rule || !rule.actions.includes(args.action)) {
      results.push({ ...item, ok: false, message: args.action === "send-back" ? "A shift is not sent back; open it to change it." : "That cannot be decided from here." });
      continue;
    }
    if (!can(args.access, rule.capability)) {
      results.push({ ...item, ok: false, message: "Your groups at the mill do not allow this." });
      continue;
    }
    try {
      if (item.kind === "plan" && args.action === "approve") {
        const order = await approveOrder(db, { companyId: args.companyId, userId: args.userId, orderId: item.id });
        await notifyMill(db, { companyId: args.companyId, to: "batch.run", actorId: args.userId, title: `Plan approved: ${order.code}`, summary: "Its maize is reserved. Start a batch from Production.", viewPath: `/milling/plan/${order.id}`, entityId: order.id }).catch(() => undefined);
        results.push({ ...item, ok: true, message: `${order.code} approved` });
      } else if (item.kind === "plan") {
        if (!reason || reason.length < 3) {
          results.push({ ...item, ok: false, message: "Say why it is sent back." });
          continue;
        }
        const order = await setOrderStatus(db, { companyId: args.companyId, userId: args.userId, orderId: item.id, status: "DRAFT", reason });
        results.push({ ...item, ok: true, message: `${order.code} sent back` });
      } else {
        const shift = await approveShift(db, { companyId: args.companyId, userId: args.userId, shiftId: item.id });
        results.push({ ...item, ok: true, message: `${shift.code} approved` });
      }
    } catch (error) {
      if (!isRefusal(error)) throw error;
      results.push({ ...item, ok: false, message: error.message });
    }
  }
  return results;
}
