import type { ListSpec, ReportDefinition } from "@/lib/reports/types";

import { LIST_BASE, mill, MILL_VIEW } from "./shared";

const MANAGE = mill("seller.manage");

/**
 * Despatch › Sellers: the mill's employees who take bags out to sell, where
 * each is today, what they owe the mill and the commission due to them. A
 * row opens the seller. Commission is paid on its own, never through payroll.
 */
const sellers: ListSpec = {
  noun: "sellers",
  read: MILL_VIEW,
  search: { placeholder: "Search sellers", keys: ["name", "number"] },
  tabs: [
    { key: "selling", label: "Selling", where: [{ column: "activeKey", op: "is", value: ["ACTIVE"] }] },
    { key: "owe", label: "Owe the mill", where: [{ column: "owed", op: "gt", value: "0" }], empty: "No seller owes the mill." },
    { key: "commission", label: "Commission due", where: [{ column: "commissionDue", op: "gt", value: "0" }], empty: "No commission is due." },
    { key: "all", label: "All", where: [] },
  ],
  filters: [
    {
      key: "today",
      label: "Today",
      type: "choice",
      any: "Any",
      primary: true,
      options: [
        { value: "out", label: "Out selling", where: [{ column: "todayKey", op: "is", value: ["OUT"] }] },
        { value: "in", label: "In", where: [{ column: "todayKey", op: "is", value: ["IN"] }] },
      ],
    },
  ],
  sorts: [
    { key: "name", label: "Name A–Z", rules: [{ column: "name", dir: "asc" }] },
    { key: "owed", label: "Owes most", rules: [{ column: "owed", dir: "desc" }] },
  ],
  groups: ["today"],
  columns: [
    { key: "name", label: "Seller", kind: "text", cell: "link", width: "minmax(180px,1.4fr)", align: "start", priority: 1 },
    { key: "number", label: "Number", kind: "code", cell: "mono", width: "110px", align: "start", priority: 2 },
    { key: "today", label: "Today", kind: "status", cell: "state", tones: { "Out selling": "info", In: "neutral", "Not selling": "hollow" }, width: "130px", align: "start", priority: 1 },
    { key: "trip", label: "Trip", kind: "code", cell: "mono", width: "140px", align: "start", priority: 3 },
    { key: "owed", label: "Owes the mill", kind: "money", cell: "owed", currency: "USD", pillKey: "owedPill", total: "sum", width: "140px", align: "end", priority: 1 },
    { key: "commissionDue", label: "Commission due", kind: "money", cell: "money", currency: "USD", total: "sum", width: "140px", align: "end", priority: 1 },
    { key: "activeKey", label: "Active", kind: "text", cell: "muted", hidden: true, width: "90px", align: "start", priority: 3 },
    { key: "todayKey", label: "Today key", kind: "text", cell: "muted", hidden: true, width: "90px", align: "start", priority: 3 },
  ],
  rowHref: "/milling/sellers/{id}",
  rowMenu: [
    { key: "give", label: "Give bags", requires: MANAGE, when: [{ column: "todayKey", op: "is", value: ["IN"] }], do: { sheet: "mill-seller-give" } },
    { key: "payment", label: "Take a payment", requires: MANAGE, when: [{ column: "owed", op: "gt", value: "0" }], do: { sheet: "mill-seller-payment" } },
    { key: "commission", label: "Pay commission", requires: MANAGE, when: [{ column: "commissionDue", op: "gt", value: "0" }], do: { sheet: "mill-seller-commission" } },
    {
      key: "stop",
      label: "Stop selling",
      tone: "bad",
      separated: true,
      requires: MANAGE,
      when: [{ column: "activeKey", op: "is", value: ["ACTIVE"] }],
      do: { confirm: { title: "Stop them selling?", body: "They no longer take bags out. Someone who is out, or owes the mill, cannot be stopped until that is settled.", confirm: "Stop selling", tone: "bad" }, endpoint: "/api/milling/sellers/retire-many" },
    },
  ],
  bulk: [{ key: "export" }],
  primary: {
    label: "New",
    icon: "plus",
    requires: MANAGE,
    menu: [
      { label: "Give a seller bags", sheet: "mill-seller-give" },
      { label: "Add a seller", sheet: "mill-seller-add" },
    ],
  },
  subLink: { label: "Commission rates", sheet: "mill-seller-rates", requires: mill("settings.manage") },
  card: { title: "name", badge: "today", figure: "owed", meta: "{number} · commission due {commissionDueText}", metaMono: ["number"] },
  empty: {
    icon: "UsersThree",
    title: "No sellers yet",
    line: "Sellers are the mill's employees who take bags out, sell them and come back the same day with the money and the bags they did not sell.",
    primary: { label: "Add a seller", sheet: "mill-seller-add", requires: MANAGE },
  },
};

/** Despatch › Seller trips: each day's bags out, what came back, what was owed and handed in, and whether it is in Books. */
const trips: ListSpec = {
  noun: "seller trips",
  read: MILL_VIEW,
  search: { placeholder: "Search trips", keys: ["code", "seller", "from"] },
  tabs: [
    { key: "out", label: "Out", where: [{ column: "stateKey", op: "is", value: ["OUT"] }], empty: "No seller is out." },
    { key: "post", label: "To post", where: [{ column: "postKey", op: "is", value: ["TO_POST"] }], empty: "Every settled trip is in Books." },
    { key: "settled", label: "Settled", where: [{ column: "stateKey", op: "is", value: ["SETTLED"] }] },
    { key: "all", label: "All", where: [] },
  ],
  filters: [
    { key: "seller", type: "parent", column: "sellerId" },
    { key: "date", label: "Date", type: "period", any: "Any time", column: "date", primary: true, default: "today" },
    { key: "who", label: "Seller", type: "choice", any: "Anyone", primary: true, optionsFromLoader: true, column: "seller" },
  ],
  sorts: [{ key: "newest", label: "Newest first", rules: [{ column: "issuedAt", dir: "desc" }] }],
  groups: ["seller", "state", "from"],
  columns: [
    { key: "code", label: "Trip", kind: "code", cell: "mono", width: "140px", align: "start", priority: 1 },
    { key: "seller", label: "Seller", kind: "text", cell: "link", href: "/milling/sellers/{sellerId}", width: "minmax(150px,1.2fr)", align: "start", priority: 1, impliedBy: { parent: "seller" } },
    { key: "from", label: "From", kind: "text", cell: "muted", width: "minmax(120px,1fr)", align: "start", priority: 3 },
    { key: "state", label: "State", kind: "status", cell: "state", tones: { Out: "info", Settled: "ok", Short: "warn", Cancelled: "hollow" }, width: "110px", align: "start", priority: 1 },
    { key: "bagsOut", label: "Bags out", kind: "number", cell: "num", total: "sum", width: "90px", align: "end", priority: 1 },
    { key: "sold", label: "Sold", kind: "number", cell: "num", total: "sum", empty: "dash", width: "80px", align: "end", priority: 2 },
    { key: "due", label: "Due", kind: "money", cell: "money", currency: "USD", total: "sum", width: "110px", align: "end", priority: 1 },
    { key: "cash", label: "Handed in", kind: "money", cell: "money", currency: "USD", total: "sum", width: "110px", align: "end", priority: 2 },
    { key: "short", label: "Short", kind: "money", cell: "owed", currency: "USD", pillKey: "shortPill", total: "sum", width: "110px", align: "end", priority: 1 },
    { key: "books", label: "Books", kind: "status", cell: "dot", tones: { Posted: "ok", "To post": "warn" }, empty: "blank", width: "100px", align: "start", priority: 2 },
    { key: "date", label: "Day", kind: "date", cell: "date", dayFormat: "relative", width: "110px", align: "end", priority: 3 },
    { key: "issuedAt", label: "Out at", kind: "date", cell: "date", hidden: true, width: "150px", align: "end", priority: 3 },
  ],
  rowHref: "/milling/sellers/{sellerId}",
  rowMenu: [
    { key: "settle", label: "Settle", requires: MANAGE, when: [{ column: "stateKey", op: "is", value: ["OUT"] }], do: { sheet: "mill-seller-settle" } },
    { key: "post", label: "Post to Books", requires: MANAGE, when: [{ column: "postKey", op: "is", value: ["TO_POST"] }], do: { sheet: "mill-seller-post" } },
    { key: "cancel", label: "Call off", tone: "bad", separated: true, requires: MANAGE, when: [{ column: "stateKey", op: "is", value: ["OUT"] }], do: { sheet: "mill-seller-cancel" } },
  ],
  bulk: [{ key: "export" }],
  primary: { label: "Give bags", icon: "plus", requires: MANAGE, sheet: "mill-seller-give" },
  card: { title: "seller", badge: "state", figure: "due", meta: "{code} · {bagsOut} bags out", metaMono: ["code"] },
  empty: {
    icon: "Package",
    title: "No seller trips yet",
    line: "A trip is the bags a seller takes out in a day. They come back the same day to settle: the bags not sold, the discounts given and the cash.",
    primary: { label: "Give bags", sheet: "mill-seller-give", requires: MANAGE },
  },
};

/** A seller's commission, trip by trip: how it was worked out, what has been paid against it, and what is due. */
const commission: ListSpec = {
  noun: "trips",
  read: MILL_VIEW,
  search: { placeholder: "Search", keys: ["code", "workings"] },
  filters: [{ key: "seller", type: "parent", column: "sellerId" }],
  sorts: [{ key: "newest", label: "Newest first", rules: [{ column: "date", dir: "desc" }] }],
  columns: [
    { key: "code", label: "Trip", kind: "code", cell: "mono", width: "140px", align: "start", priority: 1 },
    { key: "date", label: "Day", kind: "date", cell: "date", dayFormat: "medium", width: "120px", align: "start", priority: 2 },
    { key: "workings", label: "Worked out", kind: "text", cell: "muted", width: "minmax(220px,2fr)", align: "start", priority: 2 },
    { key: "earned", label: "Earned", kind: "money", cell: "money", currency: "USD", total: "sum", width: "110px", align: "end", priority: 1 },
    { key: "paid", label: "Paid", kind: "money", cell: "money", currency: "USD", total: "sum", width: "110px", align: "end", priority: 1 },
    { key: "due", label: "Due", kind: "money", cell: "money", currency: "USD", total: "sum", width: "110px", align: "end", priority: 1 },
    { key: "state", label: "State", kind: "status", cell: "state", tones: { Paid: "ok", "Part paid": "warn", Due: "pending" }, width: "110px", align: "start", priority: 1 },
  ],
  rowHref: "/milling/sellers/{sellerId}",
  card: { title: "code", badge: "state", figure: "due", meta: "{workings}" },
  empty: { icon: "Package", title: "No commission yet", line: "Commission is earned when a trip is settled." },
};

/** What a seller handed in later against what they owed, and the commission paid to them, each with its Books reference. */
const payments: ListSpec = {
  noun: "payments",
  read: MILL_VIEW,
  search: { placeholder: "Search", keys: ["what", "reference"] },
  filters: [{ key: "seller", type: "parent", column: "sellerId" }],
  sorts: [{ key: "newest", label: "Newest first", rules: [{ column: "at", dir: "desc" }] }],
  columns: [
    { key: "at", label: "When", kind: "date", cell: "date", dayFormat: "medium", width: "130px", align: "start", priority: 1 },
    { key: "what", label: "What", kind: "status", cell: "dot", tones: { "Handed in": "info", "Settlement cash": "neutral", "Commission paid": "ok" }, width: "160px", align: "start", priority: 1 },
    { key: "covers", label: "Covers", kind: "text", cell: "muted", width: "minmax(200px,2fr)", align: "start", priority: 2 },
    { key: "reference", label: "In Books", kind: "code", cell: "mono", emptyWords: "Not yet", width: "140px", align: "start", priority: 2 },
    { key: "amount", label: "Amount", kind: "money", cell: "money", currency: "USD", width: "120px", align: "end", priority: 1 },
  ],
  rowHref: "/milling/sellers/{sellerId}",
  rowMenu: [{ key: "post", label: "Post to Books", requires: MANAGE, when: [{ column: "postKey", op: "is", value: ["TO_POST"] }], do: { sheet: "mill-seller-post-payment" } }],
  card: { title: "what", figure: "amount", meta: "{covers}" },
  empty: { icon: "Package", title: "Nothing paid yet", line: "Money handed in after a trip, and commission paid, show here." },
};

const def = (key: string, title: string, href: string, list: ListSpec, sort: string, dir: "asc" | "desc"): ReportDefinition => ({
  ...LIST_BASE,
  key,
  title,
  href,
  params: [],
  columns: list.columns,
  defaults: { sort: [{ column: sort, dir }] },
  list,
});

export const SELLERS_LIST = def("milling-seller-list", "Sellers", "/milling/sellers", sellers, "name", "asc");
export const SELLER_TRIPS_LIST = def("milling-seller-trip-list", "Seller trips", "/milling/sellers/trips", trips, "issuedAt", "desc");
export const SELLER_COMMISSION_LIST = def("milling-seller-commission-list", "Seller commission", "/milling/sellers", commission, "date", "desc");
export const SELLER_PAYMENTS_LIST = def("milling-seller-payment-list", "Seller payments", "/milling/sellers", payments, "at", "desc");
