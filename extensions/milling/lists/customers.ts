import type { ListSpec, ReportDefinition } from "@/lib/reports/types";

import { LIST_BASE, mill, MILL_VIEW } from "./shared";

/**
 * Customers › Collections (canvas CU-A1): who owes the mill, on which route,
 * against their limit, and what is overdue. Record a promise from a row.
 */
const customers: ListSpec = {
  noun: "customers",
  read: MILL_VIEW,
  search: { placeholder: "Search customers", keys: ["name", "route"] },
  tabs: [
    { key: "all", label: "All", where: [] },
    { key: "overdue", label: "Overdue", where: [{ column: "overdue", op: "gt", value: "0" }], empty: "Nobody is overdue." },
    { key: "limit", label: "Over limit", where: [{ column: "stateKey", op: "is", value: ["OVER_LIMIT"] }], empty: "Nobody is over their limit." },
  ],
  filters: [{ key: "route", label: "Route", type: "choice", any: "Any", primary: true, optionsFromLoader: true, column: "route" }],
  sorts: [
    {
      key: "overdue",
      label: "Most overdue",
      rules: [
        { column: "overdue", dir: "desc" },
        { column: "owes", dir: "desc" },
      ],
    },
    { key: "owes", label: "Owes most", rules: [{ column: "owes", dir: "desc" }] },
    { key: "name", label: "Name A–Z", rules: [{ column: "name", dir: "asc" }] },
  ],
  groups: ["route", "state"],
  columns: [
    { key: "name", label: "Customer", kind: "text", cell: "link", width: "minmax(220px,1.6fr)", align: "start", priority: 1 },
    { key: "route", label: "Route", kind: "code", cell: "mono", width: "90px", align: "start", priority: 2 },
    { key: "terms", label: "Terms", kind: "text", cell: "muted", width: "90px", align: "start", priority: 3 },
    { key: "creditLimit", label: "Credit limit", kind: "money", cell: "money", currency: "USD", total: "sum", width: "130px", align: "end", priority: 2 },
    { key: "owes", label: "Owes", kind: "money", cell: "money", currency: "USD", total: "sum", width: "130px", align: "end", priority: 1 },
    { key: "overdue", label: "Overdue", kind: "money", cell: "money", currency: "USD", total: "sum", width: "130px", align: "end", priority: 1 },
    { key: "promise", label: "Promised", kind: "text", cell: "text", toneKey: "promiseTone", width: "150px", align: "start", priority: 3 },
    { key: "state", label: "State", kind: "status", cell: "state", tones: { Current: "ok", Overdue: "warn", "Over limit": "bad" }, width: "110px", align: "start", priority: 1 },
  ],
  rowHref: "/milling/collections/{id}",
  rowMenu: [
    { key: "promise", label: "Record a promise", requires: mill("collection.record"), do: { sheet: "mill-promise" } },
    { key: "terms", label: "Limit and terms", requires: mill("exception.decide"), do: { sheet: "mill-terms" } },
  ],
  bulk: [{ key: "export" }],
  card: { title: "name", badge: "state", figure: "owes", meta: "{route} · {terms}", meta2: "{promise}" },
  empty: { icon: "Users", title: "Nobody owes the mill", line: "Customers show here once Books has an issued invoice to them: what they owe, against their limit and terms." },
};

/** Customers › Visits (HM-D1): each shop visit, the competitor's price, our bags on the shelf and our share. */
const visits: ListSpec = {
  noun: "visits",
  read: MILL_VIEW,
  search: { placeholder: "Search visits", keys: ["customer", "route", "rep", "note"] },
  filters: [
    { key: "shop", type: "parent", column: "customerId" },
    { key: "date", label: "Date", type: "period", any: "Any time", column: "date", primary: true, default: "this-week" },
    { key: "route", label: "Route", type: "choice", any: "Any", primary: true, optionsFromLoader: true, column: "route" },
    { key: "rep", label: "Rep", type: "choice", any: "Anyone", primary: true, optionsFromLoader: true, column: "rep" },
  ],
  sorts: [{ key: "newest", label: "Newest first", rules: [{ column: "visitedAt", dir: "desc" }] }],
  groups: ["route", "rep"],
  columns: [
    { key: "customer", label: "Shop", kind: "text", cell: "link", width: "minmax(200px,1.5fr)", align: "start", priority: 1 },
    { key: "route", label: "Route", kind: "code", cell: "mono", width: "90px", align: "start", priority: 2 },
    { key: "rep", label: "Rep", kind: "text", cell: "text", width: "minmax(130px,1fr)", align: "start", priority: 2 },
    { key: "competitorPrice", label: "Their price", kind: "money", cell: "money", currency: "USD", total: "avg", width: "120px", align: "end", priority: 1 },
    { key: "ourBags", label: "Our bags", kind: "number", cell: "num", total: "sum", width: "100px", align: "end", priority: 1 },
    { key: "share", label: "Shelf share", kind: "number", cell: "num", percent: true, total: "avg", width: "110px", align: "end", priority: 1 },
    { key: "note", label: "Note", kind: "text", cell: "muted", width: "minmax(140px,1fr)", align: "start", priority: 3 },
    { key: "visited", label: "Visited", kind: "text", cell: "mono", width: "120px", align: "end", priority: 2 },
    { key: "visitedAt", label: "Visited at", kind: "date", cell: "date", hidden: true, width: "150px", align: "end", priority: 3 },
  ],
  rowHref: "/milling/collections/{customerId}",
  bulk: [{ key: "export" }],
  primary: { label: "Record a visit", icon: "plus", requires: mill("visit.record"), sheet: "mill-visit-new" },
  card: { title: "customer", badge: "route", figure: "share", meta: "{rep} · {visited}", meta2: "{ourBags} bags on the shelf" },
  empty: {
    icon: "Storefront",
    title: "No visits yet",
    line: "A rep records each shop: the competitor's price, our bags on the shelf and our share, with a photo.",
    primary: { label: "Record a visit", sheet: "mill-visit-new", requires: mill("visit.record") },
  },
};

/**
 * Customers › Surveys (R9): the market survey, the same visits grouped by
 * route, each route's footer the average competitor price, our bags seen and
 * our average shelf share over the days chosen.
 */
const surveys: ListSpec = {
  ...visits,
  noun: "visits",
  search: { placeholder: "Search the survey", keys: ["customer", "route", "rep"] },
  filters: [
    { key: "date", label: "Date", type: "period", any: "Any time", column: "date", primary: true, default: "this-month" },
    { key: "route", label: "Route", type: "choice", any: "Any", primary: true, optionsFromLoader: true, column: "route" },
  ],
  groups: ["route", "rep"],
  defaultGroup: "route",
  columns: visits.columns.filter((column) => column.key !== "note"),
  primary: undefined,
  empty: { icon: "Storefront", title: "No visits in these days", line: "The survey is built from the reps' shop visits: the competitor's price, our bags on the shelf and our share." },
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

export const CUSTOMERS_LIST = def("milling-customer-list", "Collections", "/milling/collections", customers, "overdue", "desc");
export const VISITS_LIST = def("milling-visit-list", "Visits", "/milling/visits", visits, "visitedAt", "desc");
export const SURVEYS_LIST = def("milling-survey-list", "Surveys", "/milling/surveys", surveys, "visitedAt", "desc");
