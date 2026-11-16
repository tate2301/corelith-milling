import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { confirmIntakeWeight } from "@/lib/milling/intake/intake";
import { prisma } from "@/lib/prisma";

const num = z.preprocess((value) => (value === "" || value === null ? undefined : value), z.coerce.number().optional());
const body = z.object({
  ticketNumber: z.string().trim().min(1, "Enter the weighbridge ticket number."),
  grossKg: num,
  tareKg: num,
  netKg: num,
  ticketFileUrl: z.string().max(500).nullable().optional(),
  reason: z.string().trim().min(3, "Say where the confirmed weight comes from."),
});

export const POST = millRoute<{ id: string }>("intake.record", async ({ companyId, userId }, request, { id }) =>
  confirmIntakeWeight(prisma, { companyId, userId, intakeId: id, ...(await readBody(request, body)) }),
);
