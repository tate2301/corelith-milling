import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { recordSellerPayment } from "@/lib/milling/sellers/trips";
import { prisma } from "@/lib/prisma";

const body = z.object({ amount: z.coerce.number().positive("Enter the amount handed in."), notes: z.string().max(2000).nullable().optional() });

/** Money a seller hands in against what they owe. */
export const POST = millRoute<{ id: string }>("seller.manage", async ({ companyId, userId }, request, { id }) =>
  recordSellerPayment(prisma, { companyId, userId, sellerId: id, ...(await readBody(request, body)) }),
);
