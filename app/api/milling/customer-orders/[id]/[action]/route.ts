import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse } from "@/lib/api-response";
import { millRoute, readBody } from "@/lib/milling/api";
import { cancelCustomerOrder, confirmCustomerOrder } from "@/lib/milling/distribution/customer-orders";
import { invoiceOrder } from "@/lib/milling/books/bridge";
import { prisma } from "@/lib/prisma";

const body = z.object({ reason: z.string().max(2000).optional() }).nullable().transform((value) => value ?? {});

/** confirm · cancel · invoice (a draft in Books) */
export const POST = millRoute<{ id: string; action: string }>("order.manage", async ({ companyId, userId }, request, { id, action }) => {
  if (action === "confirm") return confirmCustomerOrder(prisma, { companyId, userId, orderId: id });
  if (action === "invoice") return invoiceOrder(prisma, { companyId, userId, orderId: id });
  if (action === "cancel") return cancelCustomerOrder(prisma, { companyId, userId, orderId: id, reason: (await readBody(request, body)).reason ?? "" });
  return errorResponse("No such action.", 404) as NextResponse;
});
