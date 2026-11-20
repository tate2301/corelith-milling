import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { recordPromise } from "@/lib/milling/customers/customers";
import { prisma } from "@/lib/prisma";

const body = z.object({
  amount: z.coerce.number().positive("Enter the amount promised."),
  promisedFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the day they promised to pay."),
  note: z.string().max(2000).nullable().optional(),
});

/** Record a customer's promise to pay. */
export const POST = millRoute<{ id: string }>("collection.record", async ({ companyId, userId }, request, { id }) =>
  recordPromise(prisma, { companyId, userId, customerId: id, ...(await readBody(request, body)) }),
);
