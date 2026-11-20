import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";

import { addSeller, issueSellerTrip, settleSellerTrip } from "../sellers/trips";
import { recordOpeningStock } from "../stock/counts";
import { makeEmployee, makeMill, removeMill } from "../testing/fixture";
import { commissionDue, payCommission } from "./commission";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

let mill: Awaited<ReturnType<typeof makeMill>>;
let sellerId = "";
let cashId = "";
const actor = () => ({ companyId: mill.companyId, userId: mill.userId, role: "SUPERADMIN" });

beforeAll(async () => {
  mill = await makeMill("commission");
  await prisma.product.update({ where: { id: mill.product("MEAL-10") }, data: { standardPrice: 6 } });
  await prisma.millingSellerRate.create({ data: { companyId: mill.companyId, productId: mill.product("MEAL-10"), commissionPerBag: 0.25 } });
  await recordOpeningStock(prisma, { companyId: mill.companyId, userId: mill.userId, productId: mill.product("MEAL-10"), stockLocationId: mill.location("FG"), quantity: 50, lotCode: "C-1" });
  const employee = await makeEmployee(mill.companyId, "Chipo Banda");
  sellerId = (await addSeller(prisma, { companyId: mill.companyId, userId: mill.userId, employeeId: employee.id })).id;
  cashId = (await prisma.bankAccount.create({ data: { companyId: mill.companyId, name: "Gate cash", kind: "CASH", currency: "USD" } })).id;
  const trip = await issueSellerTrip(prisma, { companyId: mill.companyId, userId: mill.userId, sellerId, fromLocationId: mill.location("FG"), mayOverride: false, lines: [{ productId: mill.product("MEAL-10"), bags: 40 }], at: new Date("2026-11-20T06:00:00Z") });
  // 40 sold x 25c = $10 commission.
  await settleSellerTrip(prisma, { companyId: mill.companyId, userId: mill.userId, tripId: trip.id, returned: [], discounts: [], cashReceived: 240 });
});
afterAll(async () => {
  const where = { companyId: mill.companyId };
  await prisma.purchasePayment.deleteMany({ where }).catch(() => undefined);
  await prisma.purchaseBill.deleteMany({ where }).catch(() => undefined);
  await prisma.millingSellerCommissionPayout.deleteMany({ where });
  await removeMill(mill.companyId).catch(() => undefined);
});

describe("seller commission, paid separately", () => {
  it("is what settled trips earned, less what has been paid", async () => {
    expect((await commissionDue(prisma, mill.companyId, sellerId)).toNumber()).toBe(10);
  });

  it("is paid through a paid bill to the seller in Books, and never more than is due", async () => {
    await expect(payCommission(prisma, { ...actor(), role: "OPERATOR" }, { sellerId, amount: 4, bankAccountId: cashId })).rejects.toThrow();
    await expect(payCommission(prisma, actor(), { sellerId, amount: 12, bankAccountId: cashId })).rejects.toThrow("more than that");

    const paid = await payCommission(prisma, actor(), { sellerId, amount: 6, bankAccountId: cashId });
    expect(paid.due).toBe(4);
    expect(paid.paidInBooks).toBe(true);
    const bill = await prisma.purchaseBill.findUniqueOrThrow({ where: { id: paid.billId } });
    expect([Number(bill.total), Number(bill.amountPaid)]).toEqual([6, 6]);
    const seller = await prisma.millingSeller.findUniqueOrThrow({ where: { id: sellerId } });
    expect(bill.vendorId).toBe(seller.vendorId);

    await payCommission(prisma, actor(), { sellerId, amount: 4, bankAccountId: cashId });
    expect((await commissionDue(prisma, mill.companyId, sellerId)).toNumber()).toBe(0);
    await expect(payCommission(prisma, actor(), { sellerId, amount: 1, bankAccountId: cashId })).rejects.toThrow("No commission is due");
  });
});

describe("the commission statement", () => {
  it("explains each trip's commission and what each payment covered, and adds up", async () => {
    const { commissionStatement } = await import("./commission-statement");
    const statement = await commissionStatement(prisma, mill.companyId, sellerId);
    // One trip: 40 bags at 25c = $10, paid as $6 then $4.
    expect(statement.totals).toEqual({ earned: 10, paid: 10, due: 0 });
    expect(statement.trips[0]?.products).toEqual([{ product: expect.any(String), bags: 40, perBag: 0.25, pct: 0, soldFor: 240, perBagPart: 10, sharePart: 0, earned: 10 }]);
    expect(statement.trips[0]).toMatchObject({ earned: 10, paid: 10, due: 0 });
    // Newest first: the $4 then the $6, each covering the trip.
    expect(statement.payments.map((row) => [row.amount, row.covers.map((cover) => cover.amount)])).toEqual([[4, [4]], [6, [6]]]);
    expect(statement.payments.every((row) => row.billNumber)).toBe(true);
  });
});
