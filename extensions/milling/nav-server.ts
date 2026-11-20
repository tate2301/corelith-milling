import type { ExtensionNavContext, ExtensionNavServer } from "@/lib/extensions/server-types";
import { can } from "@/lib/milling/access/groups";
import { millPersonaFor } from "@/lib/milling/access/persona";
import { loadMillAccess } from "@/lib/milling/access/server";
import { prisma } from "@/lib/prisma";

/**
 * The mill's sidebar, server side: counts of things waiting for this person
 * (NV01: "Counts on a row are things waiting for someone") and their start
 * page and phone bar (NV03). Registered in extensions/nav-server.ts.
 */
async function access(context: ExtensionNavContext) {
  return loadMillAccess({ id: context.userId, companyId: context.companyId, role: context.role ?? "" });
}

async function badges(context: ExtensionNavContext): Promise<Record<string, string>> {
  const held = await access(context);
  if (!held.canView) return {};
  const companyId = context.companyId;
  const counts: Array<[string, Promise<number> | null]> = [
    ["/milling/intake", can(held, "qc.decide") ? prisma.millingIntake.count({ where: { companyId, status: "AWAITING_QC" } }) : null],
    ["/milling/production", can(held, "batch.approve") ? prisma.millingBatch.count({ where: { companyId, status: "AWAITING_DECISION" } }) : null],
    ["/milling/plan", can(held, "plan.approve") ? prisma.millingProductionOrder.count({ where: { companyId, status: "SUBMITTED" } }) : null],
    ["/milling/exceptions", can(held, "exception.decide") ? prisma.millingException.count({ where: { companyId, status: "OPEN" } }) : null],
    ["/milling/deliveries", can(held, "delivery.manage") ? prisma.millingDelivery.count({ where: { companyId, status: "DELIVERED" } }) : null],
  ];
  const result: Record<string, string> = {};
  await Promise.all(
    counts.map(async ([href, pending]) => {
      const count = pending ? await pending : 0;
      if (count > 0) result[href] = String(count);
    }),
  );
  return result;
}

export const MILLING_NAV: ExtensionNavServer = {
  id: "milling",
  badges,
  persona: async (context) => millPersonaFor(context.role, await access(context)),
};
