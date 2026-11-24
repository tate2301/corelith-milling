import type { ListSpec, ReportDefinition } from "@/lib/reports/types";

import { LIST_BASE, mill, MILL_VIEW } from "./shared";

/**
 * Stores › Lots and bins: every lot where it is, its state, what it holds and
 * what is reserved from it. A lot moves between places from its row; its
 * movements and tests are a click away.
 */
const lots: ListSpec = {
  noun: "lots",
  read: MILL_VIEW,
  search: { placeholder: "Search lots", keys: ["code", "product", "place"] },
  tabs: [
    { key: "all", label: "All", where: [] },
    { key: "released", label: "Released", where: [{ column: "stateKey", op: "is", value: ["AVAILABLE"] }] },
    { key: "hold", label: "On hold", where: [{ column: "stateKey", op: "is", value: ["HOLD"] }] },
    { key: "rejected", label: "Rejected", where: [{ column: "stateKey", op: "is", value: ["REJECTED"] }] },
  ],
  filters: [
    { key: "product", label: "Product", type: "choice", any: "Any", primary: true, optionsFromLoader: true, column: "product" },
    { key: "place", label: "Place", type: "choice", any: "Anywhere", primary: true, optionsFromLoader: true, column: "place" },
    { key: "category", label: "Kind", type: "choice", any: "Any", optionsFromLoader: true, column: "category" },
  ],
  sorts: [
    { key: "oldest", label: "Oldest first", rules: [{ column: "producedAt", dir: "asc" }] },
    { key: "most", label: "Most on hand", rules: [{ column: "onHand", dir: "desc" }] },
  ],
  groups: ["product", "place", "state", "category"],
  defaultGroup: "product",
  columns: [
    { key: "code", label: "Lot", kind: "code", cell: "ref", href: "/milling/quality/{lotId}", width: "minmax(170px,1.2fr)", align: "start", priority: 1 },
    { key: "product", label: "Product", kind: "text", cell: "text", width: "minmax(160px,1.2fr)", align: "start", priority: 1 },
    { key: "place", label: "Place", kind: "code", cell: "mono", width: "110px", align: "start", priority: 1 },
    { key: "state", label: "State", kind: "status", cell: "state", tones: { Released: "ok", "On hold": "warn", Rejected: "bad" }, width: "110px", align: "start", priority: 1 },
    { key: "onHand", label: "On hand", kind: "number", cell: "num", unitKey: "unit", total: "sum", width: "130px", align: "end", priority: 1 },
    { key: "reserved", label: "Reserved", kind: "number", cell: "num", total: "sum", empty: "dash", width: "110px", align: "end", priority: 2 },
    { key: "free", label: "Free", kind: "number", cell: "num", total: "sum", width: "110px", align: "end", priority: 2 },
    { key: "made", label: "Made", kind: "date", cell: "date", dayFormat: "medium", width: "120px", align: "end", priority: 3 },
    { key: "category", label: "Kind", kind: "text", cell: "muted", hidden: true, width: "120px", align: "start", priority: 3 },
    { key: "producedAt", label: "Made at", kind: "date", cell: "date", hidden: true, width: "150px", align: "end", priority: 3 },
  ],
  rowHref: "/milling/quality/{lotId}",
  rowMenu: [
    { key: "move", label: "Move", requires: mill("stock.move"), when: [{ column: "stateKey", op: "isNot", value: ["REJECTED"] }], do: { sheet: "mill-lot-move" } },
    { key: "movements", label: "Its movements", requires: MILL_VIEW, do: { href: "/milling/stock/movements?lot={lotId}" } },
    { key: "trace", label: "Trace it", requires: MILL_VIEW, do: { href: "/milling/trace?code={code}" } },
  ],
  bulk: [{ key: "export" }],
  primary: {
    label: "New",
    icon: "plus",
    requires: [...mill("stock.count"), ...mill("stock.move")],
    menu: [
      { label: "Count a place", sheet: "mill-count-place", requires: mill("stock.count") },
      { label: "Match gate sales to lots", sheet: "mill-match-gate-sales", requires: mill("stock.move") },
    ],
  },
  card: { title: "code", badge: "state", figure: "onHand", meta: "{product} · {place}", metaMono: ["code"] },
  empty: { icon: "Package", title: "No stock at the mill yet", line: "Accepted deliveries, runs and opening stock appear here as lots, in the place each is kept." },
};

/** Stores › Lot movements: every receipt, move, issue and count, by lot. */
const movements: ListSpec = {
  noun: "movements",
  read: MILL_VIEW,
  search: { placeholder: "Search movements", keys: ["lot", "product", "reason", "by"] },
  filters: [
    { key: "lot", type: "parent", column: "lotId", all: "/milling/stock/movements" },
    { key: "date", label: "Date", type: "period", any: "Any time", column: "date", primary: true, default: "7d" },
    { key: "reason", label: "What", type: "choice", any: "Any", primary: true, optionsFromLoader: true, column: "reason" },
  ],
  sorts: [{ key: "newest", label: "Newest first", rules: [{ column: "at", dir: "desc" }] }],
  groups: ["reason", "product"],
  columns: [
    { key: "when", label: "When", kind: "text", cell: "mono", width: "130px", align: "start", priority: 1 },
    { key: "lot", label: "Lot", kind: "code", cell: "ref", href: "/milling/quality/{lotId}", width: "minmax(170px,1.2fr)", align: "start", priority: 1, impliedBy: { parent: "lot" } },
    { key: "product", label: "Product", kind: "text", cell: "text", width: "minmax(150px,1fr)", align: "start", priority: 2, impliedBy: { parent: "lot" } },
    { key: "reason", label: "What", kind: "text", cell: "text", width: "150px", align: "start", priority: 1 },
    { key: "route", label: "From → to", kind: "text", cell: "mono", width: "140px", align: "start", priority: 2 },
    { key: "quantity", label: "Quantity", kind: "number", cell: "num", sign: "plain", width: "120px", align: "end", priority: 1 },
    { key: "how", label: "Figure", kind: "status", cell: "dot", tones: { Weighed: "ok", Estimated: "neutral" }, width: "110px", align: "start", priority: 3 },
    { key: "by", label: "By", kind: "text", cell: "text", width: "130px", align: "start", priority: 3 },
    { key: "at", label: "At", kind: "date", cell: "date", hidden: true, width: "150px", align: "end", priority: 3 },
  ],
  rowHref: "/milling/quality/{lotId}",
  bulk: [{ key: "export" }],
  card: { title: "lot", badge: "reason", figure: "quantity", meta: "{when} · {route}" },
  empty: { icon: "Package", title: "No movements yet", line: "Every receipt, move, issue and count of a lot appears here." },
};

/** Stores › Lot counts: each count of a place, the lots counted and how many were off. */
const counts: ListSpec = {
  noun: "counts",
  read: MILL_VIEW,
  search: { placeholder: "Search counts", keys: ["code", "place"] },
  filters: [{ key: "date", label: "Date", type: "period", any: "Any time", column: "date", primary: true, default: "any" }],
  sorts: [{ key: "newest", label: "Newest first", rules: [{ column: "countedAt", dir: "desc" }] }],
  columns: [
    { key: "code", label: "Count", kind: "code", cell: "mono", width: "150px", align: "start", priority: 1 },
    { key: "place", label: "Place", kind: "text", cell: "text", width: "minmax(160px,1.2fr)", align: "start", priority: 1 },
    { key: "when", label: "When", kind: "text", cell: "mono", width: "130px", align: "start", priority: 2 },
    { key: "lots", label: "Lots", kind: "number", cell: "num", width: "80px", align: "end", priority: 2 },
    { key: "off", label: "Lots off", kind: "number", cell: "num", empty: "dash", width: "90px", align: "end", priority: 1 },
    { key: "state", label: "State", kind: "status", cell: "state", tones: { Posted: "ok", "Waiting for a decision": "warn", Discarded: "hollow", Open: "pending" }, width: "170px", align: "start", priority: 1 },
    { key: "countedAt", label: "Counted at", kind: "date", cell: "date", hidden: true, width: "150px", align: "end", priority: 3 },
  ],
  rowHref: "/milling/exceptions",
  bulk: [{ key: "export" }],
  primary: { label: "Count a place", icon: "plus", requires: mill("stock.count"), sheet: "mill-count-place" },
  card: { title: "place", badge: "state", figure: "off", meta: "{code} · {when}" },
  empty: { icon: "Package", title: "No counts yet", line: "Count a place to check the ledger against what is there. A count that is off waits for management." },
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

export const LOTS_LIST = def("milling-lot-list", "Lots and bins", "/milling/stock", lots, "producedAt", "asc");
export const MOVEMENTS_LIST = def("milling-lot-movement-list", "Lot movements", "/milling/stock/movements", movements, "at", "desc");
export const COUNTS_LIST = def("milling-lot-count-list", "Lot counts", "/milling/stock/counts", counts, "countedAt", "desc");
