import { Prisma, type PrismaClient } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";
import { BillRefused, createPurchaseBill } from "@/lib/books/bill-create";
import { canDo, type BooksActor } from "@/lib/books/core/can-do";

import { millRefusal } from "../errors";

/**
 * Seller commission, paid separately from payroll (the client, 20 Nov 2026).
 *
 * Each settled trip earns the seller commission at the rate it went out with.
 * What the mill still owes them is what they earned less what has been paid.
 * Paying it is a paid bill to the seller as a Books supplier, from the money
 * account chosen, so the expense and the cash out are both in Books.
 *
 * Commission is never netted against a shortage: what a seller owes the mill
 * and what the mill owes them are kept apart, and each is settled on its own.
 */

type Db = PrismaClient;
const ZERO = new Prisma.Decimal(0);

/** Commission earned on settled trips, less what has been paid out. */
export async function commissionDue(db: Db | Prisma.TransactionClient, companyId: string, sellerId: string) {
  const [earned, paid] = await Promise.all([
    db.millingSellerTrip.aggregate({ where: { companyId, sellerId, status: "SETTLED" }, _sum: { commissionAmount: true } }),
    db.millingSellerCommissionPayout.aggregate({ where: { companyId, sellerId }, _sum: { amount: true } }),
  ]);
  return (earned._sum.commissionAmount ?? ZERO).minus(paid._sum.amount ?? ZERO);
}

/** The seller as a Books supplier, made the first time they are paid commission. */
async function sellerVendor(db: Db, companyId: string, sellerId: string) {
  const seller = await db.millingSeller.findFirst({ where: { id: sellerId, companyId } });
  if (!seller) throw millRefusal("That seller is not one of the mill's.");
  if (seller.vendorId) {
    const existing = await db.vendor.findFirst({ where: { id: seller.vendorId, companyId }, select: { id: true } });
    if (existing) return { vendorId: existing.id, seller };
  }
  const employee = await db.employee.findFirst({ where: { id: seller.employeeId, companyId }, select: { name: true, employeeId: true, phone: true, userId: true } });
  const vendor = await db.vendor.create({
    data: { companyId, name: `${employee?.name ?? "Seller"} (seller ${employee?.employeeId ?? ""})`.replace(" )", ")"), phone: employee?.phone ?? null },
    select: { id: true },
  });
  await db.millingSeller.update({ where: { id: seller.id }, data: { vendorId: vendor.id } });
  return { vendorId: vendor.id, seller };
}

/** Pay a seller commission they have earned, from a money account, through a paid bill in Books. */
export async function payCommission(db: Db, actor: BooksActor, args: { sellerId: string; amount: number; bankAccountId: string; notes?: string | null }) {
  const pay = canDo(actor, "pay");
  if (!pay.allowed) throw millRefusal(pay.reason);
  const amount = new Prisma.Decimal(args.amount);
  if (amount.lte(0) || !amount.equals(amount.toDecimalPlaces(2))) throw millRefusal("Enter the commission paid, in dollars and cents.");
  const account = await db.bankAccount.findFirst({ where: { id: args.bankAccountId, companyId: actor.companyId, isActive: true }, select: { id: true, currency: true } });
  if (!account) throw millRefusal("Choose the money account it is paid from.");

  const { vendorId, seller } = await sellerVendor(db, actor.companyId, args.sellerId);
  const employee = await db.employee.findFirst({ where: { id: seller.employeeId, companyId: actor.companyId }, select: { name: true, userId: true } });
  if (employee?.userId && employee.userId === actor.userId) throw millRefusal("Someone else has to pay your commission.");

  // Recorded first, under a lock, so two people paying at once cannot both pay what is due.
  const payout = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "MillingSeller" WHERE "id" = ${seller.id} FOR UPDATE`;
    const due = await commissionDue(tx, actor.companyId, seller.id);
    if (due.lte(0)) throw millRefusal(`No commission is due to ${employee?.name ?? "this seller"}.`);
    if (amount.gt(due)) throw millRefusal(`${employee?.name ?? "The seller"} is due $${due.toFixed(2)}; $${amount.toFixed(2)} is more than that.`);
    return tx.millingSellerCommissionPayout.create({
      data: { companyId: actor.companyId, sellerId: seller.id, amount, bankAccountId: account.id, paidById: actor.userId, notes: args.notes?.trim() || null },
    });
  });

  try {
    const bill = await createPurchaseBill(
      { companyId: actor.companyId, userId: actor.userId, role: actor.role ?? null },
      {
        vendorId,
        billDate: new Date().toISOString().slice(0, 10),
        currency: account.currency,
        notes: `Seller commission, ${employee?.name ?? ""}`.trim(),
        receiveNow: true,
        paidNow: { bankAccountId: account.id, reference: "Seller commission" },
        lines: [{ description: `Seller commission, ${employee?.name ?? "seller"}`, quantity: 1, unitPrice: amount.toNumber(), taxRate: 0 }],
      },
    );
    await db.millingSellerCommissionPayout.update({ where: { id: payout.id }, data: { billId: bill.id } });
    await writePlatformAuditEvent({
      companyId: actor.companyId,
      actorId: actor.userId,
      eventType: "milling.seller.commission-paid",
      entityType: "MillingSeller",
      entityId: seller.id,
      payload: { amount: amount.toFixed(2), billId: bill.id },
    });
    // Books records the payment in the same step but does not fail the bill if the payment fails: say so.
    const paid = await db.purchaseBill.findUnique({ where: { id: bill.id }, select: { amountPaid: true, total: true, billNumber: true } });
    const settled = paid ? Number(paid.amountPaid) + 0.005 >= Number(paid.total) : false;
    return { payoutId: payout.id, billId: bill.id, paidInBooks: settled, due: (await commissionDue(db, actor.companyId, seller.id)).toNumber() };
  } catch (error) {
    // Nothing reached Books: take the payout back so the commission is still due.
    await db.millingSellerCommissionPayout.delete({ where: { id: payout.id } }).catch(() => undefined);
    if (error instanceof BillRefused) throw millRefusal(error.message);
    throw error;
  }
}
