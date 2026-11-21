import { millRoute, readBody } from "@/lib/milling/api";
import { actOnOrders } from "@/lib/milling/distribution/order-many";
import { idsBody } from "@/lib/milling/reports/approve-ids";
import { prisma } from "@/lib/prisma";

/** Confirm the ticked orders from the Orders list, each through its own checks. */
export const POST = millRoute("order.manage", async ({ companyId, userId }, request) => actOnOrders(prisma, { companyId, userId, action: "confirm", ...(await readBody(request, idsBody)) }));
