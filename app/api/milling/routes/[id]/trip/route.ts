import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { planRouteTrip } from "@/lib/milling/distribution/trips";
import { prisma } from "@/lib/prisma";

const body = z.object({ vehicleId: z.string().uuid().nullable().optional(), driverId: z.string().uuid().nullable().optional() });

/** Plan a trip on this route: a delivery to load, on the route's usual vehicle unless another is chosen. */
export const POST = millRoute<{ id: string }>("delivery.manage", async ({ companyId, userId }, request, { id }) =>
  planRouteTrip(prisma, { companyId, userId, routeId: id, ...(await readBody(request, body)) }),
);
