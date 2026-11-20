import { z } from "zod";

import { booksActor, canDo } from "@/lib/books/core/can-do";
import { millRoute, readBody } from "@/lib/milling/api";
import { mayPostSellers } from "@/lib/milling/books/sellers";
import { addSeller } from "@/lib/milling/sellers/trips";
import { sellersBoard } from "@/lib/milling/sellers/views";
import { prisma } from "@/lib/prisma";

/** The sellers, what each owes, and the day's trips. */
export const GET = millRoute(null, async ({ companyId, session }, request) => {
  const actor = await booksActor(session);
  return sellersBoard(prisma, companyId, new URL(request.url).searchParams.get("date"), { mayPost: mayPostSellers(actor), mayPay: canDo(actor, "pay").allowed });
});

const body = z.object({ employeeId: z.string().uuid("Choose the employee.") });

/** Make an employee a seller. */
export const POST = millRoute("seller.manage", async ({ companyId, userId }, request) => addSeller(prisma, { companyId, userId, ...(await readBody(request, body)) }));
