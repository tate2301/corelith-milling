import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { decideIntake } from "@/lib/milling/intake/intake";
import { prisma } from "@/lib/prisma";

const body = z.object({
  decision: z.enum(["ACCEPT", "HOLD", "REJECT"]),
  binLocationId: z.string().uuid().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

export const POST = millRoute<{ id: string }>("qc.decide", async ({ companyId, userId }, request, { id }) =>
  decideIntake(prisma, { companyId, userId, intakeId: id, ...(await readBody(request, body)) }),
);
