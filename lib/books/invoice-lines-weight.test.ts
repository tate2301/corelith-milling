import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";

import { createSalesInvoice, InvoiceRefused } from "./create-invoice";
import { destroyBooksFixture, makeBooksFixture, type BooksFixture } from "./invoice-test-fixtures";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

let fixture: BooksFixture;
let mealId: string;

beforeAll(async () => {
  fixture = await makeBooksFixture("Weights");
  mealId = (
    await prisma.product.create({
      data: { companyId: fixture.companyId, name: "Mealie meal 10 kg", code: `MM10-${fixture.stamp}`, netWeightKg: 10 },
      select: { id: true },
    })
  ).id;
}, 120_000);

afterAll(async () => {
  if (fixture) {
    await prisma.salesInvoice.deleteMany({ where: { companyId: fixture.companyId } });
    await prisma.product.deleteMany({ where: { companyId: fixture.companyId } });
  }
  await destroyBooksFixture(fixture);
}, 60_000);

const draft = (lines: Parameters<typeof createSalesInvoice>[1]["lines"]) =>
  createSalesInvoice(
    { companyId: fixture.companyId, userId: fixture.ownerId },
    { customerId: fixture.customerId, invoiceDate: "2026-11-17", lines },
  );

describe("an invoice line that sells a product", () => {
  it("keeps the product's net weight and takes the discount off before tax", async () => {
    const invoice = await draft([{ description: "Mealie meal 10 kg", quantity: 100, unitPrice: 6, discountAmount: 50, taxRate: 15, productId: mealId }]);
    const [line] = invoice.lines;
    expect(line?.productId).toBe(mealId);
    expect(line?.netWeightKg?.toFixed(3)).toBe("10.000");
    expect(line?.discountAmount).toBe(50);
    // 600 − 50 = 550 net; 15% tax 82.50; 632.50 in all.
    expect([invoice.subTotal, invoice.taxTotal, invoice.total].map(Number)).toEqual([550, 82.5, 632.5]);
  });

  it("refuses another company's product and a discount bigger than the line", async () => {
    const theirs = await prisma.company.create({ data: { name: `Other ${fixture.stamp}`, slug: `other-${fixture.stamp}` } });
    const foreign = await prisma.product.create({ data: { companyId: theirs.id, name: "Bran 25 kg", code: `BR-${fixture.stamp}` } });
    try {
      await expect(draft([{ description: "Bran", quantity: 1, unitPrice: 5, productId: foreign.id }])).rejects.toThrow(InvoiceRefused);
      await expect(draft([{ description: "Meal", quantity: 1, unitPrice: 5, discountAmount: 6 }])).rejects.toThrow(/discount/);
    } finally {
      await prisma.product.delete({ where: { id: foreign.id } });
      await prisma.company.delete({ where: { id: theirs.id } });
    }
  });
});
