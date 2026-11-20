import { z } from "zod";

import { writePlatformAuditEvent } from "@/lib/audit/platform";
import { millRefusal, millRoute, readBody } from "@/lib/milling/api";
import { prisma } from "@/lib/prisma";

const body = z.object({
  productId: z.string().uuid(),
  commissionPerBag: z.coerce.number().min(0).max(1000),
  commissionPct: z.coerce.number().min(0).max(100),
});

/** Set what a seller earns on a product. Trips already out keep the rate they went out with. */
export const POST = millRoute("settings.manage", async ({ companyId, userId }, request) => {
  const input = await readBody(request, body);
  const product = await prisma.product.findFirst({ where: { id: input.productId, companyId, unit: "BAG" }, select: { id: true } });
  if (!product) throw millRefusal("Commission is set on the mill's packed products.");
  const rate = await prisma.millingSellerRate.upsert({
    where: { companyId_productId: { companyId, productId: product.id } },
    update: { commissionPerBag: input.commissionPerBag, commissionPct: input.commissionPct, updatedById: userId },
    create: { companyId, productId: product.id, commissionPerBag: input.commissionPerBag, commissionPct: input.commissionPct, updatedById: userId },
  });
  await writePlatformAuditEvent({ companyId, actorId: userId, eventType: "milling.seller-rate.changed", entityType: "MillingSellerRate", entityId: rate.id, payload: input });
  return rate;
});
