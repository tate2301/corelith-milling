import { z } from "zod";

import { can } from "@/lib/milling/access/groups";
import { millRoute, readBody } from "@/lib/milling/api";
import { voidSale } from "@/lib/milling/sales/sales";
import { prisma } from "@/lib/prisma";

const body = z.object({ reason: z.string().trim().min(3, "Say why the sale is voided.").max(2000) });

/** Void a till sale: the seller the same day, or management. */
export const POST = millRoute<{ id: string }>(null, async ({ companyId, userId, access }, request, { id }) => {
  const { reason } = await readBody(request, body);
  return voidSale(prisma, { companyId, userId, saleId: id, reason, mayVoidAny: can(access, "stock.adjust.approve") });
});
