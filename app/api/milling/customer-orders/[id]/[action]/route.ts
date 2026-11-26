import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse } from "@/lib/api-response";
import { millRoute, readBody } from "@/lib/milling/api";
import { invoiceOrder } from "@/lib/milling/books/bridge";
import { applyOrderVoucher, assignOrderRep, cancelCustomerOrder, markOrderOngoing } from "@/lib/milling/distribution/customer-orders";
import { orderActor } from "@/lib/milling/distribution/order-many";
import { prisma } from "@/lib/prisma";

const reason = z.object({ reason: z.string().max(2000).optional() }).nullable().transform((value) => value ?? {});
const assign = z.object({ salesRepId: z.string().uuid("Choose the sales rep.") });
const voucher = z.object({ orderLineId: z.string().uuid("Choose the line."), voucherId: z.string().uuid("Choose the voucher.") });

/** ongoing · assign · voucher · cancel · invoice (a draft in Books). Each service checks who may. */
export const POST = millRoute<{ id: string; action: string }>(null, async (context, request, { id, action }) => {
  const actor = orderActor(context);
  if (action === "ongoing") return markOrderOngoing(prisma, { actor, orderId: id });
  if (action === "assign") return assignOrderRep(prisma, { actor, orderId: id, ...(await readBody(request, assign)) });
  if (action === "voucher") return applyOrderVoucher(prisma, { actor, orderId: id, ...(await readBody(request, voucher)) });
  if (action === "cancel") return cancelCustomerOrder(prisma, { actor, orderId: id, reason: (await readBody(request, reason)).reason ?? "" });
  if (action === "invoice") {
    if (!context.access.capabilities.includes("money.view")) return errorResponse("Only accounting invoices orders.", 403) as NextResponse;
    return invoiceOrder(prisma, { companyId: context.companyId, userId: context.userId, orderId: id });
  }
  return errorResponse("No such action.", 404) as NextResponse;
});
