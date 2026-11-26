import { Prisma, type PrismaClient } from "@prisma/client";

import { millRefusal } from "../errors";
import { balancesOf } from "./customers";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * What a customer owes: Books' issued invoices less what was paid, credited
 * or written off, and the mill's on-account sales not yet posted to Books.
 */
export async function owedBy(db: Db, companyId: string, customerId: string): Promise<number> {
  const [books, unposted] = await Promise.all([
    balancesOf(db as PrismaClient, companyId, [customerId]),
    db.millingSale.aggregate({ where: { companyId, customerId, payment: "ON_ACCOUNT", status: "SOLD", postedAt: null }, _sum: { totalAmount: true } }),
  ]);
  return Math.round(((books.get(customerId)?.owes ?? 0) + Number(unposted._sum.totalAmount ?? 0)) * 100) / 100;
}

/**
 * A customer with an unpaid balance cannot be given a new order or sale until
 * that balance is cleared (Grandmeal spec, Stage 2 and its answers: "no new
 * sale until the earlier balance is cleared").
 */
export async function assertNothingOwed(db: Db, args: { companyId: string; customerId: string; what: "order" | "sale" }) {
  const owes = await owedBy(db, args.companyId, args.customerId);
  if (owes <= 0) return;
  const customer = await db.customer.findFirst({ where: { id: args.customerId, companyId: args.companyId }, select: { name: true } });
  throw millRefusal(`${customer?.name ?? "This customer"} still owes $${owes.toFixed(2)}. Clear it before a new ${args.what}.`);
}

/** An on-account sale to a customer who owes nothing: no more than their credit limit, when they have one. */
export async function assertWithinLimit(db: Db, args: { companyId: string; customerId: string; amount: Prisma.Decimal.Value }) {
  const terms = await db.millingCustomerTerms.findUnique({ where: { companyId_customerId: { companyId: args.companyId, customerId: args.customerId } } });
  if (terms?.creditLimit === null || terms?.creditLimit === undefined) return;
  if (new Prisma.Decimal(args.amount).gt(terms.creditLimit)) {
    throw millRefusal(`$${new Prisma.Decimal(args.amount).toFixed(2)} on account is over their limit of $${terms.creditLimit.toFixed(2)}. Take cash or EcoCash.`);
  }
}
