import { millRoute, readBody } from "@/lib/milling/api";
import { actOnOrders, orderActor } from "@/lib/milling/distribution/order-many";
import { idsBody } from "@/lib/milling/reports/approve-ids";
import { prisma } from "@/lib/prisma";

/** The rep confirms the ticked orders with their customers: Pending → Ongoing. Each checks it is that rep's. */
export const POST = millRoute("order.work", async (context, request) => actOnOrders(prisma, { actor: orderActor(context), action: "ongoing", ...(await readBody(request, idsBody)) }));
