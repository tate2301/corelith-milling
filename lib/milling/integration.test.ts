import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { setMillGroups } from "./access/membership";
import { billIntake, invoiceOrder } from "./books/bridge";
import { ongoingOrder } from "./testing/orders";
import { closeDelivery, dispatchDelivery, loadOrder, planDelivery, recordProofOfDelivery } from "./distribution/deliveries";
import { decideIntake, inspectIntake, recordIntake } from "./intake/intake";
import { followWorkshop, reportDowntime } from "./maintenance/equipment";
import { announceExceptions, holdersOf, notifyMill } from "./notify";
import { recordOpeningStock } from "./stock/counts";
import { makeMill, removeMill } from "./testing/fixture";

let mill: Awaited<ReturnType<typeof makeMill>>;
let qcId = "";
let bossId = "";
let storesId = "";
const run = Date.now().toString(36);
const who = () => ({ companyId: mill.companyId, userId: mill.userId });

beforeAll(async () => {
  mill = await makeMill("integration");
  const person = async (name: string, groups: string[]) => {
    const user = await prisma.user.create({ data: { name, email: `${name.toLowerCase()}-${run}@x.test`, role: "CLERK", companyId: mill.companyId } });
    await setMillGroups(prisma, { companyId: mill.companyId, actorId: mill.userId, userId: user.id, groups });
    return user.id;
  };
  qcId = await person("Chipo", ["QUALITY"]);
  bossId = await person("Rumbi", ["MANAGEMENT"]);
  storesId = await person("Tafadzwa", ["STORES"]);
});
afterAll(async () => {
  const notifications = await prisma.notification.findMany({ where: { companyId: mill.companyId }, select: { id: true } });
  await prisma.notificationRecipient.deleteMany({ where: { notificationId: { in: notifications.map((row) => row.id) } } });
  await prisma.notification.deleteMany({ where: { companyId: mill.companyId } });
  await prisma.purchaseBillLine.deleteMany({ where: { bill: { companyId: mill.companyId } } }).catch(() => undefined);
  await prisma.purchaseBill.deleteMany({ where: { companyId: mill.companyId } }).catch(() => undefined);
  await prisma.salesInvoiceLine.deleteMany({ where: { invoice: { companyId: mill.companyId } } }).catch(() => undefined);
  await prisma.salesInvoice.deleteMany({ where: { companyId: mill.companyId } }).catch(() => undefined);
  await prisma.userFeatureFlag.deleteMany({ where: { user: { companyId: mill.companyId } } });
  await prisma.vendor.deleteMany({ where: { companyId: mill.companyId } });
  await removeMill(mill.companyId);
});

async function acceptedIntake(price?: number) {
  const intake = await recordIntake(prisma, { ...who(), input: { productId: mill.product("MAIZE"), supplierName: "Chirau Farm", weighMethod: "BAG_COUNT", bags: 100, pricePerTonne: price } });
  const specs = await prisma.millingQcSpec.findMany({ where: { companyId: mill.companyId, point: "INCOMING_MAIZE" } });
  await inspectIntake(prisma, { ...who(), intakeId: intake.id, results: specs.map((spec) => (spec.resultType === "NUMERIC" ? { specId: spec.id, method: "INSTRUMENT" as const, value: 12 } : { specId: spec.id, method: "VISUAL" as const, passed: true })) });
  return decideIntake(prisma, { ...who(), intakeId: intake.id, decision: "ACCEPT", binLocationId: mill.location("MZ-STORE") });
}

describe("suppliers and Books", () => {
  it("puts every delivery's supplier on file, matching by name", async () => {
    const first = await acceptedIntake(320);
    const second = await acceptedIntake();
    expect(first.supplierId).toBeTruthy();
    expect(second.supplierId).toBe(first.supplierId);
    expect(await prisma.vendor.count({ where: { companyId: mill.companyId, name: { equals: "chirau farm", mode: "insensitive" } } })).toBe(1);
  });

  it("values the maize at the gate price", async () => {
    const line = await prisma.inventoryItem.findFirstOrThrow({ where: { siteId: mill.siteId, productId: mill.product("MAIZE") } });
    expect(Number(line.unitCost)).toBeCloseTo(0.32, 2);
  });

  it("drafts the supplier's bill once, and refuses one without a price", async () => {
    const priced = await prisma.millingIntake.findFirstOrThrow({ where: { companyId: mill.companyId, pricePerTonne: { not: null } } });
    const { billId } = await billIntake(prisma, { ...who(), role: "SUPERADMIN", intakeId: priced.id });
    const bill = await prisma.purchaseBill.findUniqueOrThrow({ where: { id: billId } });
    expect(bill.status).toBe("DRAFT");
    expect(Number(bill.total)).toBeCloseTo(5 * 320, 2);
    await expect(billIntake(prisma, { ...who(), role: "SUPERADMIN", intakeId: priced.id })).rejects.toThrow("already billed");
    const unpriced = await prisma.millingIntake.findFirstOrThrow({ where: { companyId: mill.companyId, pricePerTonne: null } });
    await expect(billIntake(prisma, { ...who(), role: "SUPERADMIN", intakeId: unpriced.id })).rejects.toThrow("price a tonne");
  });

  it("drafts the customer's invoice from what was delivered", async () => {
    await recordOpeningStock(prisma, { ...who(), productId: mill.product("MEAL-10"), stockLocationId: mill.location("FG"), quantity: 300 });
    const customer = await prisma.customer.create({ data: { companyId: mill.companyId, name: "Hatcliffe Store" } });
    const order = await ongoingOrder(prisma, { ...who(), customerId: customer.id, lines: [{ productId: mill.product("MEAL-10"), bags: 100, unitPrice: 7 }] });
    await expect(invoiceOrder(prisma, { ...who(), orderId: order.id })).rejects.toThrow("once it is complete");
    const truck = await prisma.equipment.findFirstOrThrow({ where: { siteId: mill.siteId, equipmentCode: "HYU-1" } });
    const delivery = await planDelivery(prisma, { ...who(), vehicleId: truck.id });
    await loadOrder(prisma, { ...who(), deliveryId: delivery.id, orderId: order.id });
    await dispatchDelivery(prisma, { ...who(), deliveryId: delivery.id });
    const lines = await prisma.millingDeliveryLine.findMany({ where: { deliveryId: delivery.id } });
    await recordProofOfDelivery(prisma, { ...who(), deliveryId: delivery.id, canManage: true, receivedBy: "Buyer", lines: lines.map((line) => ({ lineId: line.id, deliveredBags: line.bags })) });
    await closeDelivery(prisma, { ...who(), deliveryId: delivery.id });
    const { invoiceId } = await invoiceOrder(prisma, { ...who(), orderId: order.id });
    const invoice = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(invoice.status).toBe("DRAFT");
    expect(Number(invoice.subTotal)).toBeCloseTo(700, 2);
  });
});

describe("telling the next person", () => {
  it("finds the holders of a step: its groups, and owners and managers", async () => {
    const qc = await holdersOf(prisma, mill.companyId, "qc.record");
    expect(qc).toEqual(expect.arrayContaining([qcId, mill.userId]));
    expect(qc).not.toContain(storesId);
  });

  it("tells them, never the person who did it", async () => {
    await notifyMill(prisma, { companyId: mill.companyId, to: "qc.record", actorId: mill.userId, title: "Maize to inspect", summary: "x", viewPath: "/milling/intake", entityId: "e1" });
    const recipients = await prisma.notificationRecipient.findMany({ where: { notification: { companyId: mill.companyId, title: "Maize to inspect" } }, select: { userId: true } });
    expect(recipients.map((row) => row.userId)).toEqual([qcId]);
  });

  it("announces each new exception to the deciders once", async () => {
    const machine = await prisma.equipment.findFirstOrThrow({ where: { siteId: mill.siteId, equipmentCode: "RM" } });
    await reportDowntime(prisma, { companyId: mill.companyId, userId: storesId, equipmentId: machine.id, category: "BREAKDOWN", cause: "Roll bearing" });
    await announceExceptions(prisma, mill.companyId);
    await announceExceptions(prisma, mill.companyId);
    const sent = await prisma.notification.findMany({ where: { companyId: mill.companyId, title: { startsWith: "Breakdown" } }, include: { recipients: true } });
    expect(sent).toHaveLength(1);
    expect(sent[0].recipients.map((row) => row.userId)).toEqual(expect.arrayContaining([bossId]));
    expect(sent[0].recipients.map((row) => row.userId)).not.toContain(qcId);
  });
});

describe("the workshop", () => {
  it("moves a broken machine on as its work order moves in Maintenance", async () => {
    const machine = await prisma.equipment.findFirstOrThrow({ where: { siteId: mill.siteId, equipmentCode: "RM" } });
    const state = () => prisma.millingEquipmentState.findUniqueOrThrow({ where: { equipmentId: machine.id } });
    expect((await state()).availability).toBe("DOWN");
    const stop = await prisma.millingDowntime.findFirstOrThrow({ where: { equipmentId: machine.id, endedAt: null } });
    await prisma.workOrder.update({ where: { id: stop.workOrderId! }, data: { status: "IN_PROGRESS" } });
    await followWorkshop(prisma, mill.companyId);
    expect((await state()).availability).toBe("IN_REPAIR");
    await prisma.workOrder.update({ where: { id: stop.workOrderId! }, data: { status: "COMPLETED" } });
    await followWorkshop(prisma, mill.companyId);
    expect((await state()).availability).toBe("AWAITING_RELEASE");
  });
});
