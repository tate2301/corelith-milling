import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { COST_TREATMENTS, setCostTreatment } from "@/lib/milling/books/cost-treatment";
import { prisma } from "@/lib/prisma";

const body = z.object({ ids: z.array(z.string().uuid()).min(1, "Tick at least one.").max(200), treatment: z.enum(COST_TREATMENTS) });

/** Accounting sets the cost treatment of the ticked items. */
export const POST = millRoute("cost.set", async ({ companyId, userId, access }, request) => {
  const { ids, treatment } = await readBody(request, body);
  const results = [];
  for (const productId of ids) {
    const row = await setCostTreatment(prisma, { companyId, userId, mayCost: access.capabilities.includes("cost.set"), productId, treatment });
    results.push({ id: productId, ok: true, message: row.treatment });
  }
  return { results };
});
