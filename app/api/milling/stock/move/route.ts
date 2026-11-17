import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { moveLot } from "@/lib/milling/stock/ledger";
import { prisma } from "@/lib/prisma";

const body = z.object({
  lotId: z.string().uuid(),
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  quantity: z.coerce.number().positive("Move more than nothing."),
  isEstimated: z.boolean().optional(),
});

export const POST = millRoute("stock.move", async ({ companyId, userId }, request) => {
  const input = await readBody(request, body);
  return prisma.$transaction((tx) => moveLot(tx, { companyId, userId, sourceType: "MillingBinMove", ...input }));
});
