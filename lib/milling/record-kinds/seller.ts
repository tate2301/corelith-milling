import type { CommissionStatement } from "@/components/milling/commission-bits";
import { fetchJson } from "@/lib/api-client";
import type { HistoryEntry } from "@/lib/milling/records/history";
import type { Grant, RecordAction, RecordKind } from "@/lib/retail/record-kinds/types";

import { historyRail } from "./shared";

type Seller = { id: string; employeeId: string; name: string; number: string; isActive: boolean; owed: number; commissionDue: number; outOn: { id: string; code: string; date: string } | null };

export type SellerView = { seller: Seller; statement: CommissionStatement; history: HistoryEntry[] };

const MANAGE: Grant = ["ext:milling", "seller.manage"];
const usd = (value: number) => "$" + value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function primary({ seller }: SellerView): RecordAction | null {
  if (!seller.isActive) return null;
  if (seller.outOn) return { key: "settle", label: `Settle ${seller.outOn.code}`, requires: [MANAGE], do: { sheet: "mill-seller-settle", id: seller.outOn.id } };
  return {
    key: "give",
    label: "Give bags",
    requires: [MANAGE],
    disabled: seller.owed > 0 ? `${seller.name} owes ${usd(seller.owed)} from an earlier trip; a manager may let them out with a reason.` : undefined,
    do: { sheet: "mill-seller-give", params: { sellerId: seller.id } },
  };
}

/**
 * A seller (an employee who takes bags out) on core's RecordFrame: what they
 * owe the mill, the commission earned, paid and due, their trips, how each
 * trip's commission was worked out, and every payment. Commission is paid on
 * its own, never through payroll and never taken off what they owe.
 */
export const sellerKind: RecordKind<SellerView> = {
  type: "MillingSeller",
  back: { label: "Sellers", href: "/milling/sellers" },
  queryKey: (id) => ["milling-seller", id],
  load: async (id) => {
    const [board, statement, history] = await Promise.all([
      fetchJson<{ sellers: Seller[] }>("/api/milling/sellers"),
      fetchJson<CommissionStatement>(`/api/milling/sellers/${id}/commission`),
      fetchJson<HistoryEntry[]>(`/api/milling/history?entityType=MillingSeller&entityId=${id}`).catch(() => []),
    ]);
    const seller = board.sellers.find((row) => row.id === id);
    if (!seller) throw new Error("That seller is not here.");
    return { seller, statement, history };
  },
  title: ({ seller }) => seller.name,
  reference: ({ seller }) => seller.number,
  primary,
  actions: ({ seller }) => [
    ...(seller.owed > 0 ? [{ key: "payment", label: "Take a payment", requires: [MANAGE], do: { sheet: "mill-seller-payment", params: { sellerId: seller.id } } } satisfies RecordAction] : []),
    ...(seller.commissionDue > 0 ? [{ key: "commission", label: "Pay commission", requires: [MANAGE], do: { sheet: "mill-seller-commission", params: { sellerId: seller.id } } } satisfies RecordAction] : []),
  ],
  more: ({ seller }) =>
    seller.isActive
      ? [
          {
            key: "stop",
            label: "Stop selling",
            tone: "bad",
            requires: [MANAGE],
            disabled: seller.outOn || seller.owed > 0 ? "Settle their trip and what they owe first." : undefined,
            do: { post: { url: `/api/milling/sellers/${seller.id}/retire`, done: `${seller.name} stopped selling`, ask: { title: `Stop ${seller.name} selling?`, body: "They no longer take bags out. Their trips and payments stay.", keep: "Keep them", go: "Stop selling", fill: "bad" } } },
          },
        ]
      : [],
  banner: ({ seller }) =>
    !seller.isActive
      ? { lead: `${seller.name} no longer sells.`, text: "Their trips, commission and payments stay here." }
      : seller.owed > 0
        ? { lead: `${seller.name} owes the mill ${usd(seller.owed)}.`, text: "They cannot take bags again until it is paid, unless a manager lets them out with a reason.", tone: "bad" }
        : null,
  chips: ({ seller }) => [
    seller.isActive ? (seller.outOn ? { label: `Out on ${seller.outOn.code}`, tone: "info" } : { label: "In", tone: "plain" }) : { label: "Not selling", tone: "plain" },
  ],
  figure: ({ statement }) => ({ label: "Commission due", value: usd(statement.totals.due) }),
  kpis: ({ seller, statement }) => [
    { label: "Owes the mill", value: usd(seller.owed), note: seller.owed > 0 ? "from settled trips" : "Nothing owed", ...(seller.owed > 0 ? { lead: "Short", leadTone: "warn" as const } : {}) },
    { label: "Commission earned", value: usd(statement.totals.earned), note: `on ${statement.trips.length} ${statement.trips.length === 1 ? "trip" : "trips"}` },
    { label: "Commission paid", value: usd(statement.totals.paid), note: `in ${statement.payments.length} ${statement.payments.length === 1 ? "payment" : "payments"}, as bills in Books` },
    { label: "Commission due", value: usd(statement.totals.due), note: "earned less paid" },
  ],
  tabs: [
    { key: "trips", label: "Trips", source: "milling-seller-trip-list", parent: "seller", filters: () => ({ date: "any", tab: "all" }), columns: ["code", "state", "bagsOut", "sold", "due", "cash", "short", "books", "date"] },
    { key: "commission", label: "Commission", source: "milling-seller-commission-list", parent: "seller" },
    { key: "payments", label: "Payments", source: "milling-seller-payment-list", parent: "seller" },
  ],
  rail: ({ seller, history }) => [
    {
      title: "Seller",
      rows: [
        { key: "number", label: "Employee number", value: seller.number, mono: true },
        { key: "today", label: "Today", value: seller.isActive ? (seller.outOn ? `Out on ${seller.outOn.code}` : "In") : "Not selling" },
        { key: "books", label: "In Books", value: "A customer for what they take; a supplier for their commission" },
      ],
    },
    historyRail(history),
  ],
  invalidates: [["list"], ["reports"], ["milling"]],
};
