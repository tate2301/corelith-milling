import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { actOnOrders, orderActor } from "@/lib/milling/distribution/order-many";
import { prisma } from "@/lib/prisma";

const body = z.object({ ids: z.array(z.string().uuid()).min(1, "Tick at least one.").max(50), salesRepId: z.string().uuid("Choose the sales rep.") });

/** The accountant assigns the ticked orders to a sales rep. */
export const POST = millRoute("order.assign", async (context, request) => actOnOrders(prisma, { actor: orderActor(context), action: "assign", ...(await readBody(request, body)) }));

/** Who an order can be assigned to: everyone in the Sales rep group. */
export const GET = millRoute("order.assign", async ({ companyId }) => {
  const members = await prisma.millingGroupMember.findMany({ where: { companyId, groupCode: "SALES_REP" }, select: { userId: true } });
  const users = await prisma.user.findMany({
    where: { companyId, isActive: true, id: { in: members.map((row) => row.userId) } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return { rows: users };
});
