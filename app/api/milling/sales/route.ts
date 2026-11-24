import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse } from "@/lib/api-response";
import { can } from "@/lib/milling/access/groups";
import { millRoute, readBody } from "@/lib/milling/api";
import { SALE_PAYMENTS, sellAtOffice, sellFromTrip } from "@/lib/milling/sales/sales";
import { prisma } from "@/lib/prisma";

const line = z.object({ productId: z.string().uuid(), bags: z.number().int().min(0), discountPerBag: z.number().min(0).optional() });
const body = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("OFFICE"),
    stockLocationId: z.string().uuid("Choose the store the bags come from."),
    payment: z.enum(SALE_PAYMENTS),
    customerId: z.string().uuid().nullable().optional(),
    customerName: z.string().max(200).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    lines: z.array(line).min(1).max(40),
  }),
  z.object({ source: z.literal("TRIP"), customerName: z.string().max(200).nullable().optional(), notes: z.string().max(2000).nullable().optional(), lines: z.array(line).min(1).max(40) }),
]);

/** Sell at the mill's till: at the office (sale.record), or on the road from your own trip. */
export const POST = millRoute(null, async ({ companyId, userId, access }, request) => {
  const input = await readBody(request, body);
  if (input.source === "TRIP") return sellFromTrip(prisma, { companyId, userId, ...input });
  if (!can(access, "sale.record")) return errorResponse("Your groups at the mill do not let you sell at the office.", 403) as NextResponse;
  return sellAtOffice(prisma, { companyId, userId, ...input });
});
