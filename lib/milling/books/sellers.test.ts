import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";

import { addSeller, issueSellerTrip, recordSellerPayment, settleSellerTrip } from "../sellers/trips";
import { recordOpeningStock } from "../stock/counts";
import { makeEmployee, makeMill, removeMill } from "../testing/fixture";
import { mayPostSellers, postSellerPayment, postSellerTrip } from "./sellers";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

let mill: Awaited<ReturnType<typeof makeMill>>;
let sellerId = "";
let cashId = "";
const actor = () => ({ companyId: mill.companyId, userId: mill.userId, role: "SUPERADMIN" });

beforeAll(async () => {
  mill = await makeMill("seller-books");
  await prisma.product.update({ where: { id: mill.product("MEAL-10") }, data: { standardPrice: 6 } });
  await recordOpeningStock(prisma, { companyId: mill.companyId, userId: mill.userId, productId: mill.product("MEAL-10"), stockLocationId: mill.location("FG"), quantity: 100, lotCode: "B-1" });
  const employee = await makeEmployee(mill.companyId, "Tafara Ncube");
  sellerId = (await addSeller(prisma, { companyId: mill.companyId, userId: mill.userId, employeeId: employee.id })).id;
  cashId = (await prisma.bankAccount.create({ data: { companyId: mill.companyId, name: "Gate cash", kind: "CASH", currency: "USD" } })).id;
});
afterAll(async () => {
  const where = { companyId: mill.companyId };
  await prisma.salesReceipt.deleteMany({ where }).catch(() => undefined);
  await prisma.salesInvoice.deleteMany({ where }).catch(() => undefined);
  await removeMill(mill.companyId).catch(() => undefined);
});

describe("seller trips in Books", () => {
  it("is for people Books lets issue and take payments", () => {
    expect(mayPostSellers(actor())).toBe(true);
    expect(mayPostSellers({ ...actor(), role: "OPERATOR" })).toBe(false);
  });

  it("invoices the bags sold to the seller and leaves the shortage open against them", async () => {
    const trip = await issueSellerTrip(prisma, { companyId: mill.companyId, userId: mill.userId, sellerId, fromLocationId: mill.location("FG"), mayOverride: false, lines: [{ productId: mill.product("MEAL-10"), bags: 30 }], at: new Date("2026-11-20T06:00:00Z") });
    // 25 sold at $6 = 150, 5 at 20c off = 1; due 149; 140 handed in.
    await settleSellerTrip(prisma, { companyId: mill.companyId, userId: mill.userId, tripId: trip.id, returned: [{ productId: mill.product("MEAL-10"), bags: 5 }], discounts: [{ productId: mill.product("MEAL-10"), discount: 0.2, bags: 5 }], cashReceived: 140 });

    await expect(postSellerTrip(prisma, { ...actor(), role: "OPERATOR" }, { tripId: trip.id, bankAccountId: cashId })).rejects.toThrow();
    const posted = await postSellerTrip(prisma, actor(), { tripId: trip.id, bankAccountId: cashId });
    expect(posted.invoiceId).toBeTruthy();
    const invoice = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: posted.invoiceId! }, include: { lines: true } });
    expect(invoice.status).toBe("ISSUED");
    expect(invoice.lines.map((line) => [Number(line.quantity), Number(line.unitPrice), Number(line.discountAmount ?? 0)])).toEqual([[25, 6, 1]]);
    expect(Number(invoice.total)).toBe(149);
    expect(Number(invoice.amountPaid)).toBe(140);
    const seller = await prisma.millingSeller.findUniqueOrThrow({ where: { id: sellerId } });
    expect(invoice.customerId).toBe(seller.customerId);

    // Posting again changes nothing.
    const again = await postSellerTrip(prisma, actor(), { tripId: trip.id, bankAccountId: cashId });
    expect(again.invoiceId).toBe(posted.invoiceId);
    expect(await prisma.salesReceipt.count({ where: { companyId: mill.companyId } })).toBe(1);
  });

  it("puts a later repayment against what is still open", async () => {
    const { payment } = await recordSellerPayment(prisma, { companyId: mill.companyId, userId: mill.userId, sellerId, amount: 9 });
    await postSellerPayment(prisma, actor(), { paymentId: payment.id, bankAccountId: cashId });
    const invoice = await prisma.salesInvoice.findFirstOrThrow({ where: { companyId: mill.companyId } });
    expect(Number(invoice.amountPaid)).toBe(149);
    const posted = await prisma.millingSellerPayment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(posted.postedAt).not.toBeNull();
    expect(posted.booksReference).toBeTruthy();
  });
});

describe("the seller's price already holds the tax", () => {
  it("prices the line before tax so that, with tax, it is exactly what the seller owes", async () => {
    const { Prisma } = await import("@prisma/client");
    const { exTax } = await import("./sellers");
    for (const [price, sold, owed, rate] of [
      [6, 16, 95, 15.5],
      [6, 1000, 5987.4, 15.5],
      [3.5, 7, 24.5, 15],
      [6, 25, 149, 0],
    ] as const) {
      const line = exTax(new Prisma.Decimal(price), sold, new Prisma.Decimal(owed), rate);
      const net = sold * line.unitPrice - (line.discountAmount ?? 0);
      expect(net * (1 + rate / 100)).toBeCloseTo(owed, 6);
      expect(line.discountAmount ?? 0).toBeGreaterThanOrEqual(0);
    }
  });
});
