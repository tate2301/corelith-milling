import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse } from "@/lib/api-response";
import { can } from "@/lib/milling/access/groups";
import { millRoute, readBody } from "@/lib/milling/api";
import { approveShift, closeShift, openShift } from "@/lib/milling/production/shifts";
import { prisma } from "@/lib/prisma";

const body = z
  .object({
    materialInProcessKg: z.preprocess((value) => (value === "" ? null : value), z.coerce.number().min(0).nullable().optional()),
    materialEstimated: z.boolean().optional(),
    handoverNotes: z.string().max(4000).nullable().optional(),
  })
  .partial();

/** open · close · approve */
export const POST = millRoute<{ id: string; action: string }>(null, async ({ companyId, userId, access }, request, { id, action }) => {
  const base = { companyId, userId, shiftId: id };
  if (action !== "approve" && !can(access, "shift.manage")) return errorResponse("Your groups at the mill do not allow this.", 403) as NextResponse;
  if (action === "open") return openShift(prisma, base);
  if (action === "close") return closeShift(prisma, { ...base, ...(await readBody(request, body.nullable().transform((value) => value ?? {}))) });
  if (action === "approve") {
    if (!can(access, "shift.approve")) return errorResponse("A supervisor or management approves a shift.", 403) as NextResponse;
    return approveShift(prisma, base);
  }
  return errorResponse("No such action.", 404) as NextResponse;
});
