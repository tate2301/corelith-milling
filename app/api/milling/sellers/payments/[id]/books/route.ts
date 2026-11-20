import { z } from "zod";

import { booksActor } from "@/lib/books/core/can-do";
import { millRoute, readBody } from "@/lib/milling/api";
import { postSellerPayment } from "@/lib/milling/books/sellers";
import { prisma } from "@/lib/prisma";

const body = z.object({ bankAccountId: z.string().uuid("Choose the money account the cash went into.") });

/** Post a seller's repayment to Books, against their oldest open invoices. */
export const POST = millRoute<{ id: string }>(null, async ({ session }, request, { id }) =>
  postSellerPayment(prisma, await booksActor(session), { paymentId: id, ...(await readBody(request, body)) }),
);
