import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse } from "@/lib/api-response";
import { can } from "@/lib/milling/access/groups";
import { millRoute, readBody } from "@/lib/milling/api";
import { decideLot, inspectLot } from "@/lib/milling/quality/lots";
import { prisma } from "@/lib/prisma";

const schemas = {
  inspect: z.object({
    results: z.array(
      z.object({
        specId: z.string().uuid(),
        method: z.enum(["VISUAL", "INSTRUMENT", "NOT_PERFORMED"]),
        value: z.union([z.number(), z.string()]).nullable().optional(),
        passed: z.boolean().nullable().optional(),
        note: z.string().max(500).nullable().optional(),
      }),
    ),
    notes: z.string().max(2000).nullable().optional(),
  }),
  decide: z.object({ decision: z.enum(["RELEASE", "HOLD", "REJECT"]), note: z.string().max(2000).nullable().optional() }),
};

/** inspect · decide */
export const POST = millRoute<{ id: string; action: string }>(null, async ({ companyId, userId, access }, request, { id, action }) => {
  if (action === "inspect") {
    if (!can(access, "qc.record")) return errorResponse("Your groups at the mill do not allow this.", 403) as NextResponse;
    return inspectLot(prisma, { companyId, userId, lotId: id, ...(await readBody(request, schemas.inspect)) });
  }
  if (action === "decide") {
    if (!can(access, "qc.decide")) return errorResponse("The quality officer decides.", 403) as NextResponse;
    return decideLot(prisma, { companyId, userId, lotId: id, ...(await readBody(request, schemas.decide)) });
  }
  return errorResponse("No such action.", 404) as NextResponse;
});
