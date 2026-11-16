import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { recordOpeningStock } from "@/lib/milling/stock/counts";
import { prisma } from "@/lib/prisma";

const body = z.object({
  productId: z.string().uuid(),
  stockLocationId: z.string().uuid(),
  quantity: z.coerce.number().positive("Enter how much is there."),
  unitCost: z.preprocess((value) => (value === "" || value === null ? undefined : value), z.coerce.number().min(0).optional()),
  lotCode: z.string().trim().max(60).nullable().optional(),
});

/** Opening stock at go-live: management only, because it sets what the mill starts with. */
export const POST = millRoute("stock.adjust.approve", async ({ companyId, userId }, request) =>
  recordOpeningStock(prisma, { companyId, userId, ...(await readBody(request, body)) }),
);
