import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { billIntake } from "@/lib/milling/books/bridge";
import { prisma } from "@/lib/prisma";

const body = z
  .object({ pricePerTonne: z.preprocess((value) => (value === "" || value === null ? undefined : value), z.coerce.number().positive().optional()) })
  .nullable()
  .transform((value) => value ?? {});

/** Draft the supplier's bill in Books for this delivery. */
export const POST = millRoute<{ id: string }>("intake.record", async ({ companyId, userId, session }, request, { id }) =>
  billIntake(prisma, { companyId, userId, role: session.user.role, intakeId: id, ...(await readBody(request, body)) }),
);
