import type { PrismaClient } from "@prisma/client";

import { millRefusal } from "@/lib/milling/errors";

/**
 * A seller's commission statement: what each settled trip earned and how,
 * each payment and the trips it covered, and what is still due.
 *
 * Commission is paid separately from payroll. A payment covers the oldest
 * unpaid commission first, so every trip reads as paid, part-paid or due, and
 * the statement always adds up: earned − paid = due.
 */

const cents = (value: number) => Math.round(value * 100) / 100;

export interface StatementTrip {
  id: string;
  code: string;
  date: Date;
  products: Array<{ product: string; bags: number; perBag: number; pct: number; soldFor: number; perBagPart: number; sharePart: number; earned: number }>;
  earned: number;
  paid: number;
  due: number;
}

export interface StatementPayment {
  id: string;
  paidAt: Date;
  amount: number;
  billId: string | null;
  billNumber: string | null;
  covers: Array<{ code: string; amount: number }>;
}

export async function commissionStatement(db: PrismaClient, companyId: string, sellerId: string) {
  const seller = await db.millingSeller.findFirst({ where: { id: sellerId, companyId }, select: { id: true, employeeId: true } });
  if (!seller) throw millRefusal("That seller is not on this mill's list.");
  const employee = await db.employee.findFirst({ where: { id: seller.employeeId, companyId }, select: { name: true, employeeId: true } });
  const [trips, payouts] = await Promise.all([
    db.millingSellerTrip.findMany({ where: { companyId, sellerId, status: "SETTLED" }, include: { lines: true, discounts: true }, orderBy: [{ tripDate: "asc" }, { code: "asc" }] }),
    db.millingSellerCommissionPayout.findMany({ where: { companyId, sellerId }, orderBy: { paidAt: "asc" } }),
  ]);
  const productIds = [...new Set(trips.flatMap((trip) => trip.lines.map((line) => line.productId)))];
  const [products, bills] = await Promise.all([
    db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } }),
    db.purchaseBill.findMany({ where: { companyId, id: { in: payouts.map((row) => row.billId).filter((id): id is string => Boolean(id)) } }, select: { id: true, billNumber: true } }),
  ]);

  const rows: StatementTrip[] = trips
    .map((trip) => {
      const byProduct = new Map<string, { bags: number; price: number; perBag: number; pct: number }>();
      for (const line of trip.lines) {
        const entry = byProduct.get(line.productId) ?? { bags: 0, price: Number(line.unitPrice), perBag: Number(line.commissionPerBag), pct: Number(line.commissionPct) };
        entry.bags += line.bagsSold ?? 0;
        byProduct.set(line.productId, entry);
      }
      const lines = [...byProduct.entries()]
        .filter(([, entry]) => entry.bags > 0)
        .map(([productId, entry]) => {
          const discount = trip.discounts.filter((row) => row.productId === productId).reduce((sum, row) => sum + Number(row.discount) * row.bags, 0);
          const soldFor = cents(entry.price * entry.bags - discount);
          const perBagPart = cents(entry.perBag * entry.bags);
          const sharePart = cents((soldFor * entry.pct) / 100);
          return { product: products.find((row) => row.id === productId)?.name ?? "", bags: entry.bags, perBag: entry.perBag, pct: entry.pct, soldFor, perBagPart, sharePart, earned: cents(perBagPart + sharePart) };
        });
      // The trip's own figure is what was recorded at settlement; the lines explain it.
      return { id: trip.id, code: trip.code, date: trip.tripDate, products: lines, earned: Number(trip.commissionAmount ?? 0), paid: 0, due: 0 };
    })
    .filter((trip) => trip.earned > 0);

  // Each payment covers the oldest commission still due.
  const payments: StatementPayment[] = [];
  let cursor = 0;
  for (const payout of payouts) {
    let left = Number(payout.amount);
    const covers: StatementPayment["covers"] = [];
    while (left > 0.005 && cursor < rows.length) {
      const trip = rows[cursor]!;
      const open = cents(trip.earned - trip.paid);
      const take = cents(Math.min(open, left));
      trip.paid = cents(trip.paid + take);
      left = cents(left - take);
      covers.push({ code: trip.code, amount: take });
      if (trip.paid + 0.005 >= trip.earned) cursor += 1;
    }
    payments.push({
      id: payout.id,
      paidAt: payout.paidAt,
      amount: Number(payout.amount),
      billId: payout.billId,
      billNumber: bills.find((row) => row.id === payout.billId)?.billNumber ?? null,
      covers,
    });
  }
  for (const trip of rows) trip.due = cents(trip.earned - trip.paid);

  const earned = cents(rows.reduce((sum, trip) => sum + trip.earned, 0));
  const paid = cents(payouts.reduce((sum, row) => sum + Number(row.amount), 0));
  return { seller: { id: seller.id, name: employee?.name ?? "", number: employee?.employeeId ?? "" }, trips: rows.reverse(), payments: payments.reverse(), totals: { earned, paid, due: cents(earned - paid) } };
}
