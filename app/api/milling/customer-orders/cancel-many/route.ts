import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { actOnOrders, orderActor } from "@/lib/milling/distribution/order-many";
import { prisma } from "@/lib/prisma";

const body = z.object({ ids: z.array(z.string().uuid()).min(1).max(50), reason: z.string().trim().min(3, "Say why the order is cancelled.").max(2000) });

/** Cancel the ticked orders, with the reason: their rep or accounting. Bags kept for them go back to the store. */
export const POST = millRoute(null, async (context, request) => actOnOrders(prisma, { actor: orderActor(context), action: "cancel", ...(await readBody(request, body)) }));
