import { z } from "zod";

import { booksActor } from "@/lib/books/core/can-do";
import { millRoute, readBody } from "@/lib/milling/api";
import { payCommission } from "@/lib/milling/books/commission";
import { prisma } from "@/lib/prisma";

const body = z.object({
  amount: z.coerce.number().positive("Enter the commission paid."),
  bankAccountId: z.string().uuid("Choose the money account it is paid from."),
  notes: z.string().max(2000).nullable().optional(),
});

/** Pay a seller the commission they have earned, separately from payroll. Books' own payment rights decide. */
export const POST = millRoute<{ id: string }>(null, async ({ session }, request, { id }) =>
  payCommission(prisma, await booksActor(session), { sellerId: id, ...(await readBody(request, body)) }),
);
