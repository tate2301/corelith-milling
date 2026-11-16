import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { inspectIntake } from "@/lib/milling/intake/intake";
import { prisma } from "@/lib/prisma";

const body = z.object({
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
});

export const POST = millRoute<{ id: string }>("qc.record", async ({ companyId, userId }, request, { id }) => {
  const input = await readBody(request, body);
  return inspectIntake(prisma, { companyId, userId, intakeId: id, ...input });
});
