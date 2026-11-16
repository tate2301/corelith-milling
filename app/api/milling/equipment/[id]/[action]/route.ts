import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse } from "@/lib/api-response";
import { can } from "@/lib/milling/access/groups";
import { millRoute, readBody } from "@/lib/milling/api";
import { markRepaired, releaseMachine } from "@/lib/milling/maintenance/equipment";
import { prisma } from "@/lib/prisma";

const body = z.object({ note: z.string().max(2000).nullable().optional() }).nullable().transform((value) => value ?? {});

/** in-repair · repaired (the workshop) · release (the supervisor) */
export const POST = millRoute<{ id: string; action: string }>(null, async ({ companyId, userId, access }, request, { id, action }) => {
  const base = { companyId, userId, equipmentId: id };
  if (action === "release") {
    if (!can(access, "machine.release")) return errorResponse("A supervisor releases a machine.", 403) as NextResponse;
    return releaseMachine(prisma, { ...base, note: (await readBody(request, body)).note });
  }
  if (action === "in-repair" || action === "repaired") {
    if (!can(access, "fault.report")) return errorResponse("Your groups at the mill do not allow this.", 403) as NextResponse;
    await markRepaired(prisma, { ...base, inRepair: action === "in-repair" });
    return { ok: true };
  }
  return errorResponse("No such action.", 404) as NextResponse;
});
