import type { PrismaClient } from "@prisma/client";

import { assignOrderRep, logCustomerOrder, markOrderOngoing, type OrderActor, type OrderLineInput } from "../distribution/customer-orders";

/** The fixture's owner (SUPERADMIN) as an order actor: every mill right. */
export function ownerActor(who: { companyId: string; userId: string }): OrderActor {
  return { companyId: who.companyId, userId: who.userId, role: "SUPERADMIN", groups: [] };
}

/** An order taken through the pipeline to Ongoing: logged, assigned to the owner as rep, and confirmed. */
export async function ongoingOrder(db: PrismaClient, args: { companyId: string; userId: string; customerId: string; lines: OrderLineInput[] }) {
  const actor = ownerActor(args);
  await db.millingGroupMember.upsert({
    where: { userId_groupCode: { userId: args.userId, groupCode: "SALES_REP" } },
    create: { companyId: args.companyId, userId: args.userId, groupCode: "SALES_REP" },
    update: {},
  });
  const order = await logCustomerOrder(db, { actor, customerId: args.customerId, lines: args.lines });
  await assignOrderRep(db, { actor, orderId: order.id, salesRepId: args.userId });
  await markOrderOngoing(db, { actor, orderId: order.id });
  return db.millingCustomerOrder.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } });
}
