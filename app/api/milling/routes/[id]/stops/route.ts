import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { setRouteStops } from "@/lib/milling/distribution/trips";
import { prisma } from "@/lib/prisma";

const body = z.object({ customerIds: z.array(z.string().uuid()).max(200) });

/** The route's stops, in order. */
export const POST = millRoute<{ id: string }>("delivery.manage", async ({ companyId }, request, { id }) => setRouteStops(prisma, companyId, id, (await readBody(request, body)).customerIds));
