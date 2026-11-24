import { z } from "zod";

import { booksActor } from "@/lib/books/core/can-do";
import { millRoute, readBody } from "@/lib/milling/api";
import { postSellerTrip } from "@/lib/milling/books/sellers";
import { prisma } from "@/lib/prisma";

const body = z.object({ bankAccountId: z.string().uuid("Choose the money account the cash went into.") });

/** Post a settled trip to Books: the invoice for the bags sold and the cash handed in. Books' own rights decide. */
export const POST = millRoute<{ id: string }>(null, async ({ session }, request, { id }) =>
  postSellerTrip(prisma, await booksActor(session), { tripId: id, ...(await readBody(request, body)) }),
);
