import { Prisma, type PrismaClient } from "@prisma/client";

import { resolveDefaultTaxTemplate } from "@/lib/accounting/tax-rules";
import { writePlatformAuditEvent } from "@/lib/audit/platform";
import { canDo, type BooksActor } from "@/lib/books/core/can-do";
import { ReceiptRefused } from "@/lib/books/core/receipt-facts";
import { createSalesInvoice, InvoiceRefused } from "@/lib/books/create-invoice";
import { deleteInvoice } from "@/lib/books/delete-invoice";
import { DraftInvoiceRefused, issueDraftInvoice } from "@/lib/books/issue-invoice";
import { recordBooksPayment } from "@/lib/books/payment-create";

import { millRefusal } from "../errors";
import { SALE_ENTITY } from "../sales/sales";
import { exTax } from "./sellers";

/**
 * A till sale at the office in Books, as a seller's trip is: an invoice to the
 * buyer for the bags (to "Walk-in, mill till" when nobody was named), priced
 * with any tax taken out so its total is what the buyer paid, then, unless it
 * was on account, a receipt for the money into the account chosen. Books
 * issues and fiscalises the invoice under its own rules. Sales on the road
 * post with their trip, so they are not posted here.
 */

type Db = PrismaClient;
const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const day = (at: Date) => at.toISOString().slice(0, 10);
const WALK_IN = "Walk-in, mill till";

export function mayPostSales(actor: BooksActor): boolean {
  return canDo(actor, "issue").allowed && canDo(actor, "pay").allowed;
}

async function walkIn(db: Db, companyId: string) {
  const existing = await db.customer.findFirst({ where: { companyId, name: WALK_IN }, select: { id: true } });
  return existing ?? db.customer.create({ data: { companyId, name: WALK_IN }, select: { id: true } });
}

/** Post one office sale. Safe to repeat: the invoice and the receipt are each made once. */
export async function postMillSale(db: Db, actor: BooksActor, args: { saleId: string; bankAccountId: string | null }) {
  for (const right of ["issue", "pay"] as const) {
    const check = canDo(actor, right);
    if (!check.allowed) throw millRefusal(check.reason);
  }
  const sale = await db.millingSale.findFirst({ where: { id: args.saleId, companyId: actor.companyId }, include: { lines: true } });
  if (!sale) throw millRefusal("That sale is not in this workspace.");
  if (sale.status !== "SOLD") throw millRefusal(`${sale.code} is voided.`);
  if (sale.source !== "OFFICE") throw millRefusal(`${sale.code} was sold on the road; it goes to Books with its trip.`);
  if (sale.postedAt) return { invoiceId: sale.invoiceId, receipts: sale.booksReference };
  const paid = sale.payment !== "ON_ACCOUNT";
  const account = paid ? await db.bankAccount.findFirst({ where: { id: args.bankAccountId ?? "", companyId: actor.companyId, isActive: true }, select: { currency: true } }) : null;
  if (paid && !account) throw millRefusal("Choose the money account the money went into.");

  const customerId = sale.customerId ?? (await walkIn(db, actor.companyId)).id;
  let invoiceId = sale.invoiceId;
  try {
    if (!invoiceId) {
      const products = await db.product.findMany({ where: { id: { in: sale.lines.map((line) => line.productId) } }, select: { id: true, name: true } });
      const template = await resolveDefaultTaxTemplate({ companyId: actor.companyId, appliesTo: "SALES", partyType: "CUSTOMER", partyId: customerId, documentDate: sale.soldAt, currency: "USD" });
      const taxCode = template.defaultTaxCodeId ? await db.taxCode.findFirst({ where: { id: template.defaultTaxCodeId, companyId: actor.companyId }, select: { id: true, rate: true } }) : null;
      const rate = Number(taxCode?.rate ?? 0);
      const lines = sale.lines.map((line) => ({
        productId: line.productId,
        description: `${products.find((product) => product.id === line.productId)?.name ?? "Bags"}, ${sale.code}`,
        quantity: line.bags,
        ...exTax(D(line.unitPrice), line.bags, D(line.amount), rate),
        taxCodeId: taxCode?.id,
      }));
      const draft = await createSalesInvoice({ companyId: actor.companyId, userId: actor.userId }, { customerId, invoiceDate: day(sale.soldAt), notes: `Mill till ${sale.code}`, issueNow: false, lines });
      if (Math.abs(Number(draft.total) - Number(sale.totalAmount)) > 0.005) {
        await deleteInvoice(actor, draft.id, { reason: `Mill till ${sale.code}: total did not match` }).catch(() => undefined);
        throw millRefusal(`Books would make the invoice $${Number(draft.total).toFixed(2)}, not the $${Number(sale.totalAmount).toFixed(2)} the sale took. Check the customer's tax in Books.`);
      }
      // Linked before issuing, so a failure from here is retried on this draft.
      await db.millingSale.update({ where: { id: sale.id }, data: { invoiceId: draft.id } });
      invoiceId = draft.id;
    }
    const invoice = await db.salesInvoice.findFirst({ where: { id: invoiceId, companyId: actor.companyId }, select: { status: true } });
    if (invoice?.status === "DRAFT") await issueDraftInvoice({ companyId: actor.companyId, userId: actor.userId }, invoiceId);

    let reference: string | null = null;
    if (paid) {
      const result = await recordBooksPayment(actor, {
        customerId,
        bankAccountId: args.bankAccountId!,
        receivedAt: day(sale.soldAt),
        currency: account!.currency,
        amount: Number(sale.totalAmount),
        reference: sale.code,
        allocations: [{ invoiceId, amount: Number(sale.totalAmount) }],
      });
      reference = result.receipts.map((row) => row.number).join(", ");
    }
    await db.millingSale.update({ where: { id: sale.id }, data: { postedAt: new Date(), booksReference: reference } });
    await writePlatformAuditEvent({ companyId: actor.companyId, actorId: actor.userId, eventType: "milling.sale.posted", entityType: SALE_ENTITY, entityId: sale.id, payload: { invoiceId, receipts: reference } });
    return { invoiceId, receipts: reference };
  } catch (error) {
    if (error instanceof InvoiceRefused || error instanceof DraftInvoiceRefused || error instanceof ReceiptRefused) throw millRefusal(error.message);
    throw error;
  }
}
