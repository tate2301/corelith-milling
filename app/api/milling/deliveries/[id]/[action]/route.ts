import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse } from "@/lib/api-response";
import { can } from "@/lib/milling/access/groups";
import { millRoute, readBody } from "@/lib/milling/api";
import { closeDelivery, dispatchDelivery, loadOrder, recordProofOfDelivery, unloadOrder } from "@/lib/milling/distribution/deliveries";
import { prisma } from "@/lib/prisma";
import { notifyMill } from "@/lib/milling/notify";

const num = z.preprocess((value) => (value === "" || value === undefined ? null : value), z.coerce.number().nullable().optional());

const schemas = {
  order: z.object({ orderId: z.string().uuid() }),
  dispatch: z.object({ odometerOut: num }),
  proof: z.object({
    receivedBy: z.string().trim().min(1, "Who received it?"),
    signatureUrl: z.string().max(500).nullable().optional(),
    photoUrl: z.string().max(500).nullable().optional(),
    latitude: num,
    longitude: num,
    lines: z.array(z.object({ lineId: z.string().uuid(), deliveredBags: z.coerce.number().int().min(0), damagedBags: z.coerce.number().int().min(0).optional(), returnedBags: z.coerce.number().int().min(0).optional() })),
  }),
  close: z.object({ odometerIn: num, fuelLitres: num }),
};

/** load · unload · dispatch · proof (the driver) · close */
export const POST = millRoute<{ id: string; action: string }>(null, async ({ companyId, userId, access }, request, { id, action }) => {
  const manage = can(access, "delivery.manage");
  const refuse = () => errorResponse("Your groups at the mill do not allow this.", 403) as NextResponse;
  const base = { companyId, userId, deliveryId: id };
  switch (action) {
    case "load":
      if (!manage) return refuse();
      return loadOrder(prisma, { ...base, ...(await readBody(request, schemas.order)) });
    case "unload":
      if (!manage) return refuse();
      return unloadOrder(prisma, { ...base, ...(await readBody(request, schemas.order)) });
    case "dispatch":
      if (!manage) return refuse();
    {
      const delivery = await dispatchDelivery(prisma, { ...base, ...(await readBody(request, schemas.dispatch)) });
      if (delivery.driverId) {
        await notifyMill(prisma, { companyId, to: [delivery.driverId], actorId: userId, title: `Your delivery: ${delivery.code}`, summary: "Record what was delivered when you get there.", viewPath: `/milling/deliveries/${delivery.id}`, entityId: delivery.id });
      }
      return delivery;
    }
    case "proof":
      if (!manage && !can(access, "delivery.own")) return refuse();
    {
      const delivery = await recordProofOfDelivery(prisma, { ...base, canManage: manage, ...(await readBody(request, schemas.proof)) });
      await notifyMill(prisma, { companyId, to: "delivery.manage", actorId: userId, title: `Delivered: ${delivery.code}`, summary: `Received by ${delivery.receivedBy}. Reconcile and close it.`, viewPath: `/milling/deliveries/${delivery.id}`, entityId: delivery.id });
      return delivery;
    }
    case "close":
      if (!manage) return refuse();
      return closeDelivery(prisma, { ...base, ...(await readBody(request, schemas.close)) });
    default:
      return errorResponse("No such action.", 404) as NextResponse;
  }
});
