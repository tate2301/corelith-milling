import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { recordProductionRun } from "@/lib/milling/production/runs";
import { prisma } from "@/lib/prisma";

const body = z.object({
  productId: z.string().uuid("Scan or choose the product."),
  bags: z.coerce.number().int().positive("Enter the bags made."),
  batchNumber: z.string().trim().min(1, "Enter the batch number.").max(40),
  producedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date produced."),
  stockLocationId: z.string().uuid("Choose the store the bags go into."),
  actualInputKg: z.coerce.number().min(0).nullable().optional(),
});

/** Production records a run: the recipe comes off stock and the bags land under the batch number. */
export const POST = millRoute("production.run", async ({ companyId, userId }, request) => recordProductionRun(prisma, { companyId, userId, ...(await readBody(request, body)) }));
