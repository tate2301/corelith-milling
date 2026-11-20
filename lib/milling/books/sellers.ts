import { Prisma, type PrismaClient } from "@prisma/client";

import { resolveDefaultTaxTemplate } from "@/lib/accounting/tax-rules";
import { writePlatformAuditEvent } from "@/lib/audit/platform";
import { canDo, type BooksActor } from "@/lib/books/core/can-do";
import { ReceiptRefused } from "@/lib/books/core/receipt-facts";
import { createSalesInvoice, InvoiceRefused } from "@/lib/books/create-invoice";
import { openInvoicesFor, recordBooksPayment } from "@/lib/books/payment-create";
import { allocateOldestFirst } from "@/lib/books/payment-form";

import { millRefusal } from "../errors";
import { SELLER_TRIP_ENTITY } from "../sellers/trips";

/**
 * Seller trips in Books (DECISIONS.md D13: the mill drafts, Books decides).
 *
 * Each seller is a Books customer. Posting a settled trip:
 * - issues a sales invoice to the seller for the bags they sold, at the price
 *   they went out at, less the discounts they gave (Books posts and fiscalises
 *   it under its own rules);
 * - records the cash they handed in as a receipt into the money account
 *   chosen, against their oldest open invoices first.
 *
 * What is left open on the seller's invoices is the shortage, so Books'
 * debtors and ageing show what each seller owes. A later repayment is posted
 * the same way. Both steps need the person's own Books rights: issuing for
 * the invoice, paying in for the receipt.
 *
 * The mill's price is what the buyer pays, as at the gate till: any VAT is
 * inside it. Books prices an invoice before tax, so each line carries the
 * price with the tax taken out, and the invoice's total is exactly what the
 * seller owes at the mill. Books and the mill agree to the cent on every
 * seller's balance.
 *
 * Commission is not posted here: it is the mill paying its employee.
 */

type Db = PrismaClient;
const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const day = (at: Date) => at.toISOString().slice(0, 10);

export function mayPostSellers(actor: BooksActor): boolean {
  return canDo(actor, "issue").allowed && canDo(actor, "pay").allowed;
}

function refuseUnlessAllowed(actor: BooksActor) {
  const issue = canDo(actor, "issue");
  if (!issue.allowed) throw millRefusal(issue.reason);
  const pay = canDo(actor, "pay");
  if (!pay.allowed) throw millRefusal(pay.reason);
}

/** The seller's Books customer, made the first time they are posted. */
async function sellerCustomer(db: Db, companyId: string, sellerId: string) {
  const seller = await db.millingSeller.findFirst({ where: { id: sellerId, companyId } });
  if (!seller) throw millRefusal("That seller is not one of the mill's.");
  if (seller.customerId) {
    const existing = await db.customer.findFirst({ where: { id: seller.customerId, companyId }, select: { id: true, name: true } });
    if (existing) return existing;
  }
  const employee = await db.employee.findFirst({ where: { id: seller.employeeId, companyId }, select: { name: true, employeeId: true, phone: true } });
  const customer = await db.customer.create({
    data: { companyId, name: `${employee?.name ?? "Seller"} (seller ${employee?.employeeId ?? ""})`.replace(" )", ")"), phone: employee?.phone ?? null },
    select: { id: true, name: true },
  });
  await db.millingSeller.update({ where: { id: seller.id }, data: { customerId: customer.id } });
  return customer;
}

/**
 * A line priced before tax whose total, with tax, is exactly `inclusive`. The
 * unit price is rounded up to 4 places; what that rounding adds comes off as
 * discount, with the seller's own discounts, so the line never charges more.
 */
export function exTax(price: Prisma.Decimal, quantity: number, inclusive: Prisma.Decimal, ratePct: number) {
  const factor = 1 + ratePct / 100;
  const unitPrice = Math.ceil((price.toNumber() / factor) * 10_000) / 10_000;
  const net = inclusive.toNumber() / factor;
  const discountAmount = Math.max(0, quantity * unitPrice - net);
  return { unitPrice, ...(discountAmount > 0 ? { discountAmount } : {}) };
}

/** Put money a seller handed in into Books, against their oldest open invoices. */
async function postMoney(db: Db, actor: BooksActor, args: { paymentId: string; customerId: string; bankAccountId: string; reference: string }) {
  const payment = await db.millingSellerPayment.findFirst({ where: { id: args.paymentId, companyId: actor.companyId } });
  if (!payment) throw millRefusal("That payment is not in this workspace.");
  if (payment.postedAt) return { posted: false as const, reference: payment.booksReference };
  const account = await db.bankAccount.findFirst({ where: { id: args.bankAccountId, companyId: actor.companyId, isActive: true }, select: { currency: true } });
  if (!account) throw millRefusal("Choose the money account the cash went into.");

  const allocations = allocateOldestFirst(Number(payment.amount), await openInvoicesFor(actor.companyId, args.customerId));
  try {
    const result = await recordBooksPayment(actor, {
      customerId: args.customerId,
      bankAccountId: args.bankAccountId,
      receivedAt: day(payment.receivedAt),
      currency: account.currency,
      amount: Number(payment.amount),
      reference: args.reference,
      allocations,
    });
    const reference = result.receipts.map((row) => row.number).join(", ");
    await db.millingSellerPayment.update({ where: { id: payment.id }, data: { postedAt: new Date(), booksReference: reference } });
    return { posted: true as const, reference };
  } catch (error) {
    if (error instanceof ReceiptRefused) throw millRefusal(error.message);
    throw error;
  }
}

/** Post a settled trip: the invoice for the bags sold, then the cash handed in. Safe to repeat; each part is done once. */
export async function postSellerTrip(db: Db, actor: BooksActor, args: { tripId: string; bankAccountId: string }) {
  refuseUnlessAllowed(actor);
  const trip = await db.millingSellerTrip.findFirst({ where: { id: args.tripId, companyId: actor.companyId }, include: { lines: true, discounts: true } });
  if (!trip) throw millRefusal("That trip is not in this workspace.");
  if (trip.status !== "SETTLED") throw millRefusal(`${trip.code} is not settled yet.`);
  const customer = await sellerCustomer(db, actor.companyId, trip.sellerId);

  let invoiceId = trip.invoiceId;
  if (!invoiceId && D(trip.amountDue ?? 0).gt(0)) {
    const products = await db.product.findMany({ where: { id: { in: trip.lines.map((line) => line.productId) } }, select: { id: true, name: true } });
    const byProduct = new Map<string, { sold: number; price: Prisma.Decimal }>();
    for (const line of trip.lines) {
      const entry = byProduct.get(line.productId) ?? { sold: 0, price: D(line.unitPrice) };
      entry.sold += line.bagsSold ?? 0;
      byProduct.set(line.productId, entry);
    }
    // The tax Books would put on this seller's invoice, so it can be taken out of the price instead.
    const template = await resolveDefaultTaxTemplate({ companyId: actor.companyId, appliesTo: "SALES", partyType: "CUSTOMER", partyId: customer.id, documentDate: trip.tripDate, currency: "USD" });
    const taxCode = template.defaultTaxCodeId ? await db.taxCode.findFirst({ where: { id: template.defaultTaxCodeId, companyId: actor.companyId }, select: { id: true, rate: true } }) : null;
    const rate = Number(taxCode?.rate ?? 0);
    const lines = [...byProduct]
      .filter(([, entry]) => entry.sold > 0)
      .map(([productId, entry]) => {
        const discount = trip.discounts.filter((row) => row.productId === productId).reduce((sum, row) => sum.plus(D(row.discount).times(row.bags)), D(0));
        const inclusive = entry.price.times(entry.sold).minus(discount);
        return { productId, description: `${products.find((product) => product.id === productId)?.name ?? "Bags"}, ${trip.code}`, quantity: entry.sold, ...exTax(entry.price, entry.sold, inclusive, rate), taxCodeId: taxCode?.id };
      });
    try {
      const invoice = await createSalesInvoice(
        { companyId: actor.companyId, userId: actor.userId },
        { customerId: customer.id, invoiceDate: day(trip.tripDate), notes: `Seller trip ${trip.code}`, issueNow: true, lines },
      );
      // Guard: the invoice must say what the mill says the seller owes.
      if (Math.abs(Number(invoice.total) - Number(trip.amountDue)) > 0.005) {
        throw millRefusal(`Books made the invoice $${Number(invoice.total).toFixed(2)}, not the $${Number(trip.amountDue).toFixed(2)} the seller owes. Check the tax on the seller's customer in Books.`);
      }
      invoiceId = invoice.id;
      await db.millingSellerTrip.update({ where: { id: trip.id }, data: { invoiceId } });
      await writePlatformAuditEvent({ companyId: actor.companyId, actorId: actor.userId, eventType: "milling.seller-trip.invoiced", entityType: SELLER_TRIP_ENTITY, entityId: trip.id, payload: { invoiceId } });
    } catch (error) {
      if (error instanceof InvoiceRefused) throw millRefusal(error.message);
      throw error;
    }
  }

  const settlement = await db.millingSellerPayment.findFirst({ where: { companyId: actor.companyId, tripId: trip.id, kind: "SETTLEMENT" } });
  const money = settlement ? await postMoney(db, actor, { paymentId: settlement.id, customerId: customer.id, bankAccountId: args.bankAccountId, reference: trip.code }) : null;
  return { invoiceId, receipts: money?.reference ?? null };
}

/** Post a repayment a seller made later. */
export async function postSellerPayment(db: Db, actor: BooksActor, args: { paymentId: string; bankAccountId: string }) {
  refuseUnlessAllowed(actor);
  const payment = await db.millingSellerPayment.findFirst({ where: { id: args.paymentId, companyId: actor.companyId } });
  if (!payment) throw millRefusal("That payment is not in this workspace.");
  if (payment.kind === "SETTLEMENT" && payment.tripId) return postSellerTrip(db, actor, { tripId: payment.tripId, bankAccountId: args.bankAccountId });
  const customer = await sellerCustomer(db, actor.companyId, payment.sellerId);
  const money = await postMoney(db, actor, { paymentId: payment.id, customerId: customer.id, bankAccountId: args.bankAccountId, reference: "Seller repayment" });
  return { invoiceId: null, receipts: money.reference };
}
