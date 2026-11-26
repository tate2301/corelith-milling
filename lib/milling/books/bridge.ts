import type { PrismaClient } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";
import { BillRefused, createPurchaseBill } from "@/lib/books/bill-create";
import { createSalesInvoice, InvoiceRefused } from "@/lib/books/create-invoice";

import { millRefusal } from "../errors";
import { CUSTOMER_ORDER_ENTITY } from "../distribution/customer-orders";
import { INTAKE_ENTITY } from "../intake/intake";

/**
 * The mill and Books (DECISIONS.md, D13). The mill drafts; Books decides.
 *
 * - A delivery of maize becomes a draft supplier bill: the tonnes at the
 *   agreed price. Receiving and paying it are Books' own steps, under Books'
 *   own rules (who may approve, VAT on the supplier's fiscal invoice).
 * - A delivered order becomes a draft sales invoice: what was delivered, at
 *   the order's price. Issuing it, which fiscalises it, is a person's step in
 *   Books.
 *
 * Each is drafted once; the mill keeps the link and shows it.
 */

const today = () => new Date().toISOString().slice(0, 10);

export async function billIntake(
  db: PrismaClient,
  args: { companyId: string; userId: string; role: string; intakeId: string; pricePerTonne?: number | null },
) {
  const intake = await db.millingIntake.findFirst({ where: { id: args.intakeId, companyId: args.companyId } });
  if (!intake) throw millRefusal("That intake is not in this workspace.");
  if (intake.billId) throw millRefusal(`${intake.code} is already billed.`);
  if (intake.status !== "ACCEPTED") throw millRefusal("Bill a delivery once it is accepted.");
  if (!intake.supplierId) throw millRefusal("This delivery's supplier is not on file; choose one before billing.");
  const price = args.pricePerTonne ?? (intake.pricePerTonne ? Number(intake.pricePerTonne) : null);
  if (!price || price <= 0) throw millRefusal("Enter the price a tonne.");
  const tonnes = Math.round(Number(intake.netKg)) / 1000;
  try {
    const bill = await createPurchaseBill(
      { companyId: args.companyId, userId: args.userId, role: args.role },
      {
        vendorId: intake.supplierId,
        billDate: today(),
        notes: `Maize delivery ${intake.code}${intake.ticketNumber ? `, weighbridge ticket ${intake.ticketNumber}` : ""}${intake.weightStatus === "PROVISIONAL" ? " (weight provisional)" : ""}`,
        receiveNow: false,
        lines: [{ description: `Maize, ${intake.code}${intake.variety ? `, ${intake.variety}` : ""}`, quantity: tonnes, unitPrice: price }],
      },
    );
    await db.millingIntake.update({ where: { id: intake.id }, data: { billId: bill.id, pricePerTonne: price } });
    await writePlatformAuditEvent({ companyId: args.companyId, actorId: args.userId, eventType: "milling.intake.billed", entityType: INTAKE_ENTITY, entityId: intake.id, payload: { billId: bill.id, tonnes, pricePerTonne: price } });
    return { billId: bill.id };
  } catch (error) {
    if (error instanceof BillRefused) throw millRefusal(error.message);
    throw error;
  }
}

export async function invoiceOrder(db: PrismaClient, args: { companyId: string; userId: string; orderId: string }) {
  const order = await db.millingCustomerOrder.findFirst({ where: { id: args.orderId, companyId: args.companyId }, include: { lines: true } });
  if (!order) throw millRefusal("That order is not in this workspace.");
  if (order.invoiceId) throw millRefusal(`${order.code} is already invoiced.`);
  if (order.status !== "COMPLETE") throw millRefusal("Invoice an order once it is complete.");
  const [delivered, products] = await Promise.all([
    db.millingDeliveryLine.findMany({ where: { orderId: order.id, delivery: { status: "CLOSED" } } }),
    db.product.findMany({ where: { companyId: args.companyId, id: { in: order.lines.map((line) => line.productId) } }, select: { id: true, name: true, standardPrice: true } }),
  ]);
  const lines = order.lines
    .map((line) => {
      const product = products.find((entry) => entry.id === line.productId);
      const bags = delivered.filter((row) => row.orderLineId === line.id).reduce((sum, row) => sum + (row.deliveredBags ?? 0), 0);
      const unitPrice = line.unitPrice ? Number(line.unitPrice) : Number(product?.standardPrice ?? 0);
      return { description: `${product?.name ?? "Product"}, ${order.code}`, quantity: bags, unitPrice };
    })
    .filter((line) => line.quantity > 0);
  if (!lines.length) throw millRefusal("Nothing on this order was delivered.");
  if (lines.some((line) => line.unitPrice <= 0)) throw millRefusal("Set a price on the order's lines, or on the products, before invoicing.");
  try {
    const invoice = await createSalesInvoice(
      { companyId: args.companyId, userId: args.userId },
      { customerId: order.customerId, invoiceDate: today(), notes: `Delivered against ${order.code}`, issueNow: false, lines },
    );
    await db.millingCustomerOrder.update({ where: { id: order.id }, data: { invoiceId: invoice.id } });
    await writePlatformAuditEvent({ companyId: args.companyId, actorId: args.userId, eventType: "milling.customer-order.invoiced", entityType: CUSTOMER_ORDER_ENTITY, entityId: order.id, payload: { invoiceId: invoice.id } });
    return { invoiceId: invoice.id };
  } catch (error) {
    if (error instanceof InvoiceRefused) throw millRefusal(error.message);
    throw error;
  }
}
