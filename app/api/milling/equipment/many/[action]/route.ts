import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api-response";
import { can } from "@/lib/milling/access/groups";
import { millRoute, readBody } from "@/lib/milling/api";
import { markRepaired, releaseMachine } from "@/lib/milling/maintenance/equipment";
import { notifyMill } from "@/lib/milling/notify";
import { idsBody } from "@/lib/milling/reports/approve-ids";
import { prisma } from "@/lib/prisma";

/** in-repair · repaired · release, over the ticked machines on Machine release. */
export const POST = millRoute<{ action: string }>(null, async ({ companyId, userId, access }, request, { action }) => {
  const { ids } = await readBody(request, idsBody);
  if (action === "release") {
    if (!can(access, "machine.release")) return errorResponse("A supervisor releases a machine.", 403) as NextResponse;
    for (const id of ids) await releaseMachine(prisma, { companyId, userId, equipmentId: id, note: null });
    return { released: ids.length };
  }
  if (action === "in-repair" || action === "repaired") {
    if (!can(access, "fault.report")) return errorResponse("Your groups at the mill do not allow this.", 403) as NextResponse;
    for (const id of ids) {
      await markRepaired(prisma, { companyId, userId, equipmentId: id, inRepair: action === "in-repair" });
      if (action === "repaired") await notifyMill(prisma, { companyId, to: "machine.release", actorId: userId, title: "Machine repaired", summary: "Release it for work when you have checked it.", viewPath: "/milling/maintenance", entityId: id });
    }
    return { done: ids.length };
  }
  return errorResponse("No such action.", 404) as NextResponse;
});
