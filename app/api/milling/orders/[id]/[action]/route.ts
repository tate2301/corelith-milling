import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse } from "@/lib/api-response";
import { can } from "@/lib/milling/access/groups";
import { millRoute, readBody } from "@/lib/milling/api";
import { approveOrder, setOrderStatus, submitOrder } from "@/lib/milling/production/orders";
import { prisma } from "@/lib/prisma";
import { notifyMill } from "@/lib/milling/notify";

const body = z.object({ approveShort: z.boolean().optional(), reason: z.string().max(2000).nullable().optional() }).partial();

/** submit · approve · send-back · cancel · close */
export const POST = millRoute<{ id: string; action: string }>("plan.edit", async (context, request, { id, action }) => {
  const { companyId, userId, access } = context;
  const input = await readBody(request, body.nullable().transform((value) => value ?? {}));
  const base = { companyId, userId, orderId: id };
  switch (action) {
    case "submit": {
      const order = await submitOrder(prisma, base);
      await notifyMill(prisma, { companyId, to: "plan.approve", actorId: userId, title: `Plan to approve: ${order.code}`, summary: `${order.shiftKind === "DAY" ? "Day" : "Night"} shift, ${order.productionDate.toISOString().slice(0, 10)}`, viewPath: `/milling/plan/${order.id}`, entityId: order.id });
      return order;
    }
    case "approve": {
      if (!can(access, "plan.approve")) return errorResponse("Only management approves a plan.", 403) as NextResponse;
      const order = await approveOrder(prisma, { ...base, approveShort: input.approveShort, reason: input.reason });
      await notifyMill(prisma, { companyId, to: "batch.run", actorId: userId, title: `Plan approved: ${order.code}`, summary: "Its maize is reserved. Start a batch from Production.", viewPath: `/milling/plan/${order.id}`, entityId: order.id });
      return order;
    }
    case "send-back":
      if (!can(access, "plan.approve")) return errorResponse("Only management sends a plan back.", 403) as NextResponse;
      return setOrderStatus(prisma, { ...base, status: "DRAFT", reason: input.reason });
    case "cancel":
      return setOrderStatus(prisma, { ...base, status: "CANCELLED", reason: input.reason });
    case "close":
      return setOrderStatus(prisma, { ...base, status: "CLOSED", reason: input.reason });
    default:
      return errorResponse("No such action.", 404) as NextResponse;
  }
});
