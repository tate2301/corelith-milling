import type { ListSpec, ReportDefinition } from "@/lib/reports/types";

import { LIST_BASE, mill, MILL_VIEW } from "./shared";

/**
 * Sales: every sale at the mill's own till, at the office or on the road,
 * newest first. A sale at the office goes to Books from here; one on the
 * road goes with its trip. Sell opens the till.
 */
const sales: ListSpec = {
  noun: "sales",
  read: MILL_VIEW,
  search: { placeholder: "Search sales", keys: ["code", "customer", "seller", "trip"] },
  tabs: [
    { key: "all", label: "All", where: [{ column: "stateKey", op: "is", value: ["SOLD"] }] },
    { key: "post", label: "To post", where: [{ column: "booksKey", op: "is", value: ["TO_POST"] }], empty: "Every office sale is in Books." },
    { key: "voided", label: "Voided", where: [{ column: "stateKey", op: "is", value: ["VOIDED"] }], empty: "No sale has been voided." },
  ],
  filters: [
    { key: "date", label: "Sold", type: "period", any: "Any time", column: "date", primary: true, default: "today" },
    {
      key: "where",
      label: "Where",
      type: "choice",
      any: "Anywhere",
      primary: true,
      options: [
        { value: "office", label: "At the office", where: [{ column: "where", op: "is", value: ["At the office"] }] },
        { value: "road", label: "On the road", where: [{ column: "where", op: "is", value: ["On the road"] }] },
      ],
    },
    { key: "seller", label: "Sold by", type: "choice", any: "Anyone", primary: true, optionsFromLoader: true, column: "seller" },
  ],
  sorts: [
    { key: "newest", label: "Newest first", rules: [{ column: "soldAt", dir: "desc" }] },
    { key: "biggest", label: "Biggest first", rules: [{ column: "total", dir: "desc" }] },
  ],
  groups: ["where", "seller", "payment"],
  columns: [
    { key: "code", label: "Sale", kind: "code", cell: "ref", width: "132px", align: "start", priority: 1 },
    { key: "where", label: "Where", kind: "text", cell: "text", width: "120px", align: "start", priority: 2 },
    { key: "customer", label: "Buyer", kind: "text", cell: "text", strong: true, width: "minmax(160px,1.4fr)", align: "start", priority: 1 },
    { key: "seller", label: "Sold by", kind: "text", cell: "text", width: "minmax(130px,1fr)", align: "start", priority: 2 },
    { key: "bags", label: "Bags", kind: "number", cell: "num", total: "sum", width: "90px", align: "end", priority: 2 },
    { key: "total", label: "Total", kind: "money", cell: "money", currency: "USD", total: "sum", width: "120px", align: "end", priority: 1 },
    { key: "payment", label: "Paid", kind: "text", cell: "text", width: "110px", align: "start", priority: 2 },
    { key: "books", label: "Books", kind: "status", cell: "dot", tones: { Posted: "ok", "To post": "warn", "With its trip": "hollow", Voided: "hollow" }, width: "130px", align: "start", priority: 2 },
    { key: "time", label: "Sold", kind: "text", cell: "mono", width: "110px", align: "end", priority: 2 },
    { key: "soldAt", label: "Sold at", kind: "date", cell: "date", hidden: true, width: "150px", align: "end", priority: 3 },
  ],
  rowHref: "/milling/sales",
  rowMenu: [
    { key: "post", label: "Post to Books", requires: mill("sale.record"), when: [{ column: "booksKey", op: "is", value: ["TO_POST"] }], do: { sheet: "mill-sale-post" } },
    { key: "void", label: "Void", tone: "bad", separated: true, requires: mill("sale.record"), when: [{ column: "stateKey", op: "is", value: ["SOLD"] }, { column: "booksKey", op: "isNot", value: ["POSTED"] }], do: { sheet: "mill-sale-void" } },
  ],
  bulk: [
    { key: "post", label: "Post to Books", requires: mill("sale.record"), when: [{ column: "booksKey", op: "is", value: ["TO_POST"] }], do: { sheet: "mill-sale-post" } },
    { key: "export" },
  ],
  primary: { label: "Sell", icon: "plus", requires: MILL_VIEW, sheet: "mill-sell" },
  card: { title: "customer", badge: "books", figure: "total", meta: "{code} · {where} · {time}", metaMono: ["code"], meta2: "{bags} bags · {payment}" },
  empty: { icon: "Receipt", title: "No sales yet", line: "Sell bags at the office from a store, or on the road from the bags you took out.", primary: { label: "Sell", sheet: "mill-sell", requires: MILL_VIEW } },
};

export const SALES_LIST: ReportDefinition = {
  ...LIST_BASE,
  key: "milling-sale-list",
  title: "Bag sales",
  href: "/milling/sales",
  params: [],
  columns: sales.columns,
  defaults: { sort: [{ column: "soldAt", dir: "desc" }] },
  list: sales,
};
