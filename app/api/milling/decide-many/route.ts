import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { decideMany } from "@/lib/milling/reports/decide-many";
import { prisma } from "@/lib/prisma";

const body = z.object({
  action: z.enum(["approve", "send-back"]),
  items: z.array(z.object({ kind: z.enum(["plan", "shift"]), id: z.string().uuid() })).min(1, "Choose at least one record.").max(50),
  reason: z.string().max(2000).nullable().optional(),
});

/** Approve or send back several records at once from the Overview; each answers for itself. */
export const POST = millRoute(null, async ({ companyId, userId, access }, request) => {
  const input = await readBody(request, body);
  return { results: await decideMany(prisma, { companyId, userId, access, ...input }) };
});
