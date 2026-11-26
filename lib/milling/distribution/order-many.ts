import type { PrismaClient } from "@prisma/client";

import { isRefusal } from "../api";
import type { MillContext } from "../access/server";
import { invoiceOrder } from "../books/bridge";
import { millRefusal } from "../errors";

import { assignOrderRep, cancelCustomerOrder, markOrderOngoing, type OrderActor } from "./customer-orders";

export type OrderAction = "ongoing" | "assign" | "invoice" | "cancel";

/** The person acting on an order, from a mill route's context. */
export function orderActor(context: Pick<MillContext, "companyId" | "userId" | "session" | "access">): OrderActor {
  return { companyId: context.companyId, userId: context.userId, role: String(context.session.user.role ?? ""), groups: context.access.groups };
}

/**
 * One press over the ticked orders on the Orders list: each through its own
 * service and checks, one at a time. One refused does not stop the others;
 * the press is refused only when none went.
 */
export async function actOnOrders(db: PrismaClient, args: { actor: OrderActor; action: OrderAction; ids: string[]; reason?: string; salesRepId?: string }) {
  const { actor } = args;
  const results: Array<{ id: string; ok: boolean; message: string }> = [];
  for (const id of args.ids) {
    try {
      const order =
        args.action === "ongoing"
          ? await markOrderOngoing(db, { actor, orderId: id })
          : args.action === "assign"
            ? await assignOrderRep(db, { actor, orderId: id, salesRepId: args.salesRepId ?? "" })
            : args.action === "invoice"
              ? await invoiceOrder(db, { companyId: actor.companyId, userId: actor.userId, orderId: id })
              : await cancelCustomerOrder(db, { actor, orderId: id, reason: args.reason ?? "" });
      results.push({ id, ok: true, message: String((order as { code?: string } | null)?.code ?? "Done") });
    } catch (error) {
      if (!isRefusal(error)) throw error;
      results.push({ id, ok: false, message: error.message });
    }
  }
  if (!results.some((row) => row.ok)) throw millRefusal(results.map((row) => row.message).join(" "));
  return { results };
}
