import type { PrismaClient } from "@prisma/client";

import { isRefusal } from "../api";
import { invoiceOrder } from "../books/bridge";
import { millRefusal } from "../errors";

import { cancelCustomerOrder, confirmCustomerOrder } from "./customer-orders";

export type OrderAction = "confirm" | "invoice" | "cancel";

/**
 * One press over the ticked orders on the Orders list: each through its own
 * service and checks, one at a time. One refused does not stop the others;
 * the press is refused only when none went.
 */
export async function actOnOrders(db: PrismaClient, args: { companyId: string; userId: string; action: OrderAction; ids: string[]; reason?: string }) {
  const results: Array<{ id: string; ok: boolean; message: string }> = [];
  for (const id of args.ids) {
    try {
      const order =
        args.action === "confirm"
          ? await confirmCustomerOrder(db, { companyId: args.companyId, userId: args.userId, orderId: id })
          : args.action === "invoice"
            ? await invoiceOrder(db, { companyId: args.companyId, userId: args.userId, orderId: id })
            : await cancelCustomerOrder(db, { companyId: args.companyId, userId: args.userId, orderId: id, reason: args.reason ?? "" });
      results.push({ id, ok: true, message: String((order as { code?: string } | null)?.code ?? "Done") });
    } catch (error) {
      if (!isRefusal(error)) throw error;
      results.push({ id, ok: false, message: error.message });
    }
  }
  if (!results.some((row) => row.ok)) throw millRefusal(results.map((row) => row.message).join(" "));
  return { results };
}
