/**
 * Grandmeal's order pipeline (docs/milling/grandmeal-workflow.md, Stage 2):
 * marketing logs, the accountant assigns a rep, the rep confirms; who may do
 * each; bags or tonnes; the unpaid-balance block on orders and sales; one
 * voucher a customer, on a line.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { issueVoucher, voucherDiscount } from "../customers/vouchers";
import { sellAtOffice } from "../sales/sales";
import { recordOpeningStock } from "../stock/counts";
import { makeMill, removeMill } from "../testing/fixture";
import {
  applyOrderVoucher,
  assignOrderRep,
  bagsInTonnes,
  cancelCustomerOrder,
  logCustomerOrder,
  markOrderOngoing,
  orderScope,
  type OrderActor,
} from "./customer-orders";

let mill: Awaited<ReturnType<typeof makeMill>>;
let marketing: OrderActor;
let accountant: OrderActor;
let rep: OrderActor;
let otherRep: OrderActor;
let customerId = "";
const DAY = new Date("2026-11-26T00:00:00Z");

async function person(name: string, groups: string[]): Promise<OrderActor> {
  const user = await prisma.user.create({ data: { name, email: `${name.toLowerCase().replace(/\W/g, "")}-${Date.now()}@x.test`, role: "CLERK", companyId: mill.companyId } });
  for (const groupCode of groups) await prisma.millingGroupMember.create({ data: { companyId: mill.companyId, userId: user.id, groupCode } });
  return { companyId: mill.companyId, userId: user.id, role: "CLERK", groups };
}

beforeAll(async () => {
  mill = await makeMill("order-pipeline");
  marketing = await person("Rudo Agent", ["MARKETING"]);
  accountant = await person("Farai Accounts", ["ACCOUNTANT"]);
  rep = await person("Clement Rep", ["SALES_REP"]);
  otherRep = await person("Tino Rep", ["SALES_REP"]);
  customerId = (await prisma.customer.create({ data: { companyId: mill.companyId, name: "Shamva Wholesalers" } })).id;
  await prisma.product.update({ where: { id: mill.product("MEAL-10") }, data: { standardPrice: 8 } });
});
afterAll(async () => {
  await prisma.salesInvoice.deleteMany({ where: { companyId: mill.companyId } });
  await removeMill(mill.companyId);
});

describe("bags or tonnes", () => {
  it("turns tonnes into whole bags by the bag's net weight", () => {
    expect([bagsInTonnes(1, 5), bagsInTonnes(1, 10), bagsInTonnes(1, 20), bagsInTonnes(1, 50)]).toEqual([200, 100, 50, 20]);
    expect(bagsInTonnes(0.3, 50)).toBe(6);
    expect(bagsInTonnes(0.33, 50)).toBeNull();
  });
});

describe("the pipeline", () => {
  let orderId = "";

  it("lets marketing log an order as Pending, in tonnes, with the agent on it; nobody else logs", async () => {
    await expect(logCustomerOrder(prisma, { actor: rep, customerId, lines: [{ productId: mill.product("MEAL-10"), bags: 10 }] })).rejects.toThrow("Only marketing");
    await expect(logCustomerOrder(prisma, { actor: marketing, customerId, lines: [{ productId: mill.product("MEAL-10"), tonnes: 0.25 }] })).resolves.toBeTruthy();
    await expect(logCustomerOrder(prisma, { actor: marketing, customerId, lines: [{ productId: mill.product("MEAL-10"), tonnes: 0.255 }] })).rejects.toThrow("not a whole number of bags");
    const order = await logCustomerOrder(prisma, { actor: marketing, customerId, lines: [{ productId: mill.product("MEAL-10"), tonnes: 2 }] });
    orderId = order.id;
    expect(order).toMatchObject({ status: "PENDING", marketingAgentId: marketing.userId, salesRepId: null });
    expect(order.lines[0]).toMatchObject({ bags: 200 });
    expect(Number(order.lines[0]!.enteredTonnes)).toBe(2);
  });

  it("adds a new customer with the order", async () => {
    const order = await logCustomerOrder(prisma, { actor: marketing, newCustomer: { name: "Nyabira Tuck Shop", phone: "+263772000111" }, lines: [{ productId: mill.product("MEAL-10"), bags: 30 }] });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: order.customerId } })).name).toBe("Nyabira Tuck Shop");
  });

  it("is assigned to a rep by the accountant only, and only to a sales rep", async () => {
    await expect(markOrderOngoing(prisma, { actor: rep, orderId })).rejects.toThrow("no sales rep yet");
    await expect(assignOrderRep(prisma, { actor: marketing, orderId, salesRepId: rep.userId })).rejects.toThrow("Only the accountant");
    await expect(assignOrderRep(prisma, { actor: accountant, orderId, salesRepId: marketing.userId })).rejects.toThrow("Sales rep group");
    const assigned = await assignOrderRep(prisma, { actor: accountant, orderId, salesRepId: rep.userId });
    expect(assigned.salesRepId).toBe(rep.userId);
  });

  it("moves to Ongoing by its own rep, not another rep or marketing", async () => {
    await expect(markOrderOngoing(prisma, { actor: otherRep, orderId })).rejects.toThrow("another rep's order");
    await expect(markOrderOngoing(prisma, { actor: marketing, orderId })).rejects.toThrow("another rep's order");
    const ongoing = await markOrderOngoing(prisma, { actor: rep, orderId });
    expect(ongoing.status).toBe("ONGOING");
    await expect(markOrderOngoing(prisma, { actor: rep, orderId })).rejects.toThrow("ongoing");
  });

  it("shows a rep their orders and marketing what it logged", async () => {
    const seen = async (actor: OrderActor) => (await prisma.millingCustomerOrder.findMany({ where: { companyId: mill.companyId, ...orderScope(actor) }, select: { id: true } })).map((row) => row.id);
    expect(await seen(rep)).toEqual([orderId]);
    expect(await seen(otherRep)).toEqual([]);
    expect((await seen(marketing)).length).toBe(3);
    expect((await seen(accountant)).length).toBe(3);
  });

  it("takes a voucher on one line, once, within the line", async () => {
    await expect(issueVoucher(prisma, { companyId: mill.companyId, userId: rep.userId, customerId, kind: "PER_BAG", value: 0.5, expiresOn: "2026-12-31", useLimit: 1, today: DAY })).resolves.toBeTruthy();
    await expect(issueVoucher(prisma, { companyId: mill.companyId, userId: rep.userId, customerId, kind: "PERCENT", value: 5, expiresOn: "2026-12-31", useLimit: 1, today: DAY })).rejects.toThrow("One voucher a customer");
    const voucher = await prisma.millingVoucher.findFirstOrThrow({ where: { companyId: mill.companyId, customerId } });
    const line = (await prisma.millingCustomerOrderLine.findFirstOrThrow({ where: { orderId } })).id;
    await expect(applyOrderVoucher(prisma, { actor: otherRep, orderId, orderLineId: line, voucherId: voucher.id })).rejects.toThrow("another rep's order");
    const applied = await applyOrderVoucher(prisma, { actor: rep, orderId, orderLineId: line, voucherId: voucher.id });
    expect(Number(applied.discount)).toBe(100);
    expect((await prisma.millingVoucher.findUniqueOrThrow({ where: { id: voucher.id } })).status).toBe("USED");
    // Used up: a new one can be issued.
    await expect(issueVoucher(prisma, { companyId: mill.companyId, userId: rep.userId, customerId, kind: "FIXED", value: 20, expiresOn: "2026-12-31", useLimit: 1, today: DAY })).resolves.toBeTruthy();
    expect(Number(voucherDiscount({ kind: "FIXED", value: 500 }, { bags: 2, unitPrice: 8 }))).toBe(16);
    expect(Number(voucherDiscount({ kind: "PERCENT", value: 10 }, { bags: 3, unitPrice: 8 }))).toBe(2.4);
  });

  it("is cancelled by its rep or accounting, with a reason", async () => {
    const extra = await logCustomerOrder(prisma, { actor: marketing, customerId, lines: [{ productId: mill.product("MEAL-10"), bags: 5 }] });
    await expect(cancelCustomerOrder(prisma, { actor: accountant, orderId: extra.id, reason: "" })).rejects.toThrow("Say why");
    await expect(cancelCustomerOrder(prisma, { actor: marketing, orderId: extra.id, reason: "Changed mind" })).rejects.toThrow("Only its rep or accounting");
    const cancelled = await cancelCustomerOrder(prisma, { actor: accountant, orderId: extra.id, reason: "Changed mind" });
    expect(cancelled).toMatchObject({ status: "CANCELLED", cancelReason: "Changed mind", cancelledById: accountant.userId });
  });
});

describe("a customer who owes", () => {
  it("gets no new order and no new sale until it is cleared", async () => {
    await prisma.salesInvoice.create({ data: { companyId: mill.companyId, customerId, invoiceDate: new Date("2026-11-01"), dueDate: new Date("2026-11-15"), status: "ISSUED", total: 120, amountPaid: 20 } });
    await expect(logCustomerOrder(prisma, { actor: marketing, customerId, lines: [{ productId: mill.product("MEAL-10"), bags: 5 }] })).rejects.toThrow("still owes $100.00");
    await recordOpeningStock(prisma, { companyId: mill.companyId, userId: mill.userId, productId: mill.product("MEAL-10"), stockLocationId: mill.location("FG"), quantity: 20 });
    await expect(
      sellAtOffice(prisma, { companyId: mill.companyId, userId: mill.userId, stockLocationId: mill.location("FG"), customerId, payment: "CASH", lines: [{ productId: mill.product("MEAL-10"), bags: 2 }] }),
    ).rejects.toThrow("still owes");
    await prisma.salesInvoice.updateMany({ where: { companyId: mill.companyId, customerId }, data: { amountPaid: 120 } });
    await expect(logCustomerOrder(prisma, { actor: marketing, customerId, lines: [{ productId: mill.product("MEAL-10"), bags: 5 }] })).resolves.toBeTruthy();
  });
});
