import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { setCustomerTerms } from "@/lib/milling/customers/customers";
import { prisma } from "@/lib/prisma";

const body = z.object({
  creditLimit: z.coerce.number().min(0).nullable(),
  termsDays: z.coerce.number().int().min(0).max(365),
});

/** Set what a customer may owe and how long they have to pay. Management decides. */
export const POST = millRoute<{ id: string }>("exception.decide", async ({ companyId, userId }, request, { id }) =>
  setCustomerTerms(prisma, { companyId, userId, customerId: id, ...(await readBody(request, body)) }),
);
