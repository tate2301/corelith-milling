import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { cancelIntake } from "@/lib/milling/intake/intake";
import { prisma } from "@/lib/prisma";

const body = z.object({ reason: z.string().trim().min(3, "Say why it is cancelled.") });

export const POST = millRoute<{ id: string }>("intake.record", async ({ companyId, userId }, request, { id }) =>
  cancelIntake(prisma, { companyId, userId, intakeId: id, ...(await readBody(request, body)) }),
);
