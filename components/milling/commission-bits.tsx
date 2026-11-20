/** A seller's commission statement as the API sends it (see lib/milling/books/commission-statement.ts). */
export type CommissionStatement = {
  seller: { id: string; name: string; number: string };
  trips: Array<{
    id: string;
    code: string;
    date: string;
    products: Array<{ product: string; bags: number; perBag: number; pct: number; soldFor: number; perBagPart: number; sharePart: number; earned: number }>;
    earned: number;
    paid: number;
    due: number;
  }>;
  payments: Array<{ id: string; paidAt: string; amount: number; billId: string | null; billNumber: string | null; covers: Array<{ code: string; amount: number }> }>;
  totals: { earned: number; paid: number; due: number };
};

export function tripState(trip: { paid: number; due: number }): "PAID" | "PART" | "DUE" {
  if (trip.due <= 0.005) return "PAID";
  return trip.paid > 0 ? "PART" : "DUE";
}

/**
 * The trips a payment of `amount` would cover, oldest commission first, as the
 * statement allocates it: what each trip gets, and whether it is then paid.
 */
export function wouldCover(trips: CommissionStatement["trips"], amount: number) {
  let left = Math.round(amount * 100) / 100;
  const rows: Array<{ code: string; amount: number; clears: boolean }> = [];
  for (const trip of [...trips].reverse()) {
    if (left <= 0.005) break;
    if (trip.due <= 0.005) continue;
    const take = Math.round(Math.min(trip.due, left) * 100) / 100;
    left = Math.round((left - take) * 100) / 100;
    rows.push({ code: trip.code, amount: take, clears: take + 0.005 >= trip.due });
  }
  return rows;
}
