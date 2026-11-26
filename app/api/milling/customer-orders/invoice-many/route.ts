import { millRoute, readBody } from "@/lib/milling/api";
import { actOnOrders, orderActor } from "@/lib/milling/distribution/order-many";
import { idsBody } from "@/lib/milling/reports/approve-ids";
import { prisma } from "@/lib/prisma";

/** Invoice the ticked Complete orders in Books: accounting only. */
export const POST = millRoute("money.view", async (context, request) => actOnOrders(prisma, { actor: orderActor(context), action: "invoice", ...(await readBody(request, idsBody)) }));
