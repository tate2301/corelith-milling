import { z } from "zod";

import { writePlatformAuditEvent } from "@/lib/audit/platform";
import { millRefusal, millRoute, readBody } from "@/lib/milling/api";
import { prisma } from "@/lib/prisma";

const one = z.object({
  productId: z.string().uuid(),
  commissionPerBag: z.coerce.number().min(0).max(1000),
  commissionPct: z.coerce.number().min(0).max(100),
});
const body = z.union([z.object({ rates: z.array(one).min(1).max(50) }), one]);

/** Set what a seller earns on a product, or on several at once (the Commission rates sheet). Trips already out keep the rate they went out with. */
export const POST = millRoute("settings.manage", async ({ companyId, userId }, request) => {
  const parsed = await readBody(request, body);
  const list = "rates" in parsed ? parsed.rates : [parsed];
  const saved = [];
  for (const input of list) saved.push(await setRate(companyId, userId, input));
  return "rates" in parsed ? { saved: saved.length } : saved[0];
});

async function setRate(companyId: string, userId: string, input: z.infer<typeof one>) {
  const product = await prisma.product.findFirst({ where: { id: input.productId, companyId, unit: "BAG" }, select: { id: true } });
  if (!product) throw millRefusal("Commission is set on the mill's packed products.");
  const rate = await prisma.millingSellerRate.upsert({
    where: { companyId_productId: { companyId, productId: product.id } },
    update: { commissionPerBag: input.commissionPerBag, commissionPct: input.commissionPct, updatedById: userId },
    create: { companyId, productId: product.id, commissionPerBag: input.commissionPerBag, commissionPct: input.commissionPct, updatedById: userId },
  });
  await writePlatformAuditEvent({ companyId, actorId: userId, eventType: "milling.seller-rate.changed", entityType: "MillingSellerRate", entityId: rate.id, payload: input });
  return rate;
}
