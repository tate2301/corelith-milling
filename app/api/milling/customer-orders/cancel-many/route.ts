import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { actOnOrders } from "@/lib/milling/distribution/order-many";
import { prisma } from "@/lib/prisma";

const body = z.object({ ids: z.array(z.string().uuid()).min(1).max(50), reason: z.string().trim().min(3, "Say why the order is cancelled.").max(2000) });

/** Cancel the ticked orders, with the reason; their reserved bags go back to stock. */
export const POST = millRoute("order.manage", async ({ companyId, userId }, request) => actOnOrders(prisma, { companyId, userId, action: "cancel", ...(await readBody(request, body)) }));
