import type { ListSpec, ReportDefinition } from "@/lib/reports/types";

import { LIST_BASE, MILL_VIEW } from "./shared";

/**
 * The tables inside mill records, as list sources scoped to their record by a
 * parent filter (RecordFrame's tabs): a trip's stops, and the like. Without
 * the parent they have no rows.
 */

/** A trip's stops (canvas DS-A2): each despatch note's customer, what was loaded and what came of it. */
const stops: ListSpec = {
  noun: "stops",
  read: MILL_VIEW,
  search: { placeholder: "Search stops", keys: ["order", "customer", "product", "lot"] },
  filters: [{ key: "delivery", type: "parent", column: "deliveryId" }],
  sorts: [{ key: "order", label: "In loading order", rules: [{ column: "order", dir: "asc" }] }],
  columns: [
    { key: "order", label: "Note", kind: "code", cell: "mono", width: "140px", align: "start", priority: 1 },
    { key: "customer", label: "Customer", kind: "text", cell: "text", strong: true, width: "minmax(180px,1.4fr)", align: "start", priority: 1 },
    { key: "product", label: "Product", kind: "text", cell: "muted", width: "minmax(130px,1fr)", align: "start", priority: 2 },
    { key: "lot", label: "Lot", kind: "code", cell: "ref", href: "/milling/trace?code={lot}", width: "160px", align: "start", priority: 3 },
    {
      key: "state",
      label: "State",
      kind: "status",
      cell: "state",
      tones: { Loaded: "pending", Delivered: "ok", Short: "warn", "Not delivered": "warn" },
      width: "130px",
      align: "start",
      priority: 1,
    },
    { key: "bags", label: "Bags", kind: "number", cell: "num", total: "sum", width: "80px", align: "end", priority: 1 },
    { key: "delivered", label: "Delivered", kind: "number", cell: "num", total: "sum", empty: "dash", width: "100px", align: "end", priority: 1 },
    { key: "short", label: "Short", kind: "number", cell: "num", total: "sum", empty: "dash", width: "80px", align: "end", priority: 2 },
    { key: "damaged", label: "Damaged", kind: "number", cell: "num", total: "sum", empty: "dash", width: "90px", align: "end", priority: 3 },
    { key: "returned", label: "Returned", kind: "number", cell: "num", total: "sum", empty: "dash", width: "90px", align: "end", priority: 3 },
    { key: "value", label: "Value", kind: "money", cell: "money", currency: "USD", total: "sum", width: "120px", align: "end", priority: 2 },
  ],
  rowHref: "/milling/collections/{customerId}",
  card: { title: "customer", badge: "state", figure: "bags", meta: "{order} · {product}", metaMono: ["order"] },
  empty: { icon: "Truck", title: "Nothing loaded yet", line: "Load confirmed orders onto the trip; each becomes a stop." },
};

export const STOPS_LIST: ReportDefinition = {
  ...LIST_BASE,
  key: "milling-delivery-lines",
  title: "Trip stops",
  href: "/milling/deliveries",
  params: [],
  columns: stops.columns,
  defaults: { sort: [{ column: "order", dir: "asc" }] },
  list: stops,
};

/** A customer's unpaid invoices in Books (CU-A2), oldest due first, overdue ones flagged. */
const invoices: ListSpec = {
  noun: "invoices",
  read: MILL_VIEW,
  search: { placeholder: "Search invoices", keys: ["number"] },
  filters: [{ key: "customer", type: "parent", column: "customerId" }],
  sorts: [{ key: "due", label: "Oldest due first", rules: [{ column: "due", dir: "asc" }] }],
  columns: [
    { key: "number", label: "Invoice", kind: "code", cell: "ref", href: "/books/invoices/{id}", width: "minmax(140px,1fr)", align: "start", priority: 1 },
    { key: "due", label: "Due", kind: "date", cell: "date", dayFormat: "medium", width: "130px", align: "end", priority: 1 },
    { key: "state", label: "State", kind: "status", cell: "state", tones: { Overdue: "warn", Current: "ok" }, width: "120px", align: "start", priority: 1 },
    { key: "late", label: "Days late", kind: "number", cell: "num", empty: "blank", width: "100px", align: "end", priority: 2 },
    { key: "open", label: "Amount", kind: "money", cell: "money", currency: "USD", total: "sum", width: "130px", align: "end", priority: 1 },
  ],
  rowHref: "/books/invoices/{id}",
  card: { title: "number", badge: "state", figure: "open", meta: "Due {dueText}" },
  empty: { icon: "Receipt", title: "Nothing unpaid", line: "Their issued invoices in Books are all paid." },
};

/** A customer's despatches (CU-A2): each note that carried their bags, and what came of it. */
const customerDespatches: ListSpec = {
  noun: "despatches",
  read: MILL_VIEW,
  search: { placeholder: "Search despatches", keys: ["code", "order"] },
  filters: [{ key: "customer", type: "parent", column: "customerId" }],
  sorts: [{ key: "newest", label: "Newest first", rules: [{ column: "date", dir: "desc" }] }],
  columns: [
    { key: "code", label: "Note", kind: "code", cell: "ref", width: "150px", align: "start", priority: 1 },
    { key: "order", label: "Order", kind: "code", cell: "mono", width: "150px", align: "start", priority: 3 },
    { key: "date", label: "Date", kind: "date", cell: "date", dayFormat: "medium", width: "130px", align: "end", priority: 1 },
    { key: "state", label: "State", kind: "status", cell: "state", tones: { Planned: "pending", Loading: "info", Out: "info", Delivered: "ok", Short: "warn", "Not delivered": "warn", Closed: "ok" }, width: "130px", align: "start", priority: 1 },
    { key: "bags", label: "Bags", kind: "number", cell: "num", total: "sum", width: "90px", align: "end", priority: 1 },
  ],
  rowHref: "/milling/deliveries/{deliveryId}",
  card: { title: "code", badge: "state", figure: "bags", meta: "{order}" },
  empty: { icon: "Truck", title: "No despatches yet", line: "Their confirmed orders go out on despatch notes." },
};

/** A route's stops in the order the truck visits them (DS-B3). */
const routeStops: ListSpec = {
  noun: "stops",
  read: MILL_VIEW,
  search: { placeholder: "Search stops", keys: ["customer", "area"] },
  filters: [{ key: "route", type: "parent", column: "routeId" }],
  sorts: [{ key: "stop", label: "In order", rules: [{ column: "stop", dir: "asc" }] }],
  columns: [
    { key: "stop", label: "Stop", kind: "number", cell: "num", width: "70px", align: "start", priority: 1 },
    { key: "customer", label: "Customer", kind: "text", cell: "link", width: "minmax(220px,1.6fr)", align: "start", priority: 1 },
    { key: "area", label: "Area", kind: "text", cell: "muted", width: "minmax(130px,1fr)", align: "start", priority: 2 },
    { key: "owes", label: "Owes", kind: "money", cell: "money", currency: "USD", total: "sum", width: "130px", align: "end", priority: 2 },
  ],
  rowHref: "/milling/collections/{id}",
  card: { title: "customer", figure: "owes", meta: "Stop {stop} · {area}" },
  empty: { icon: "MapTrifold", title: "No stops yet", line: "Add the shops the truck visits, in order." },
};

const recordSource = (key: string, title: string, list: ListSpec, sort: string, dir: "asc" | "desc"): ReportDefinition => ({
  ...LIST_BASE,
  key,
  title,
  href: "/milling",
  params: [],
  columns: list.columns,
  defaults: { sort: [{ column: sort, dir }] },
  list,
});

export const CUSTOMER_INVOICES_LIST = recordSource("milling-customer-invoices", "Customer invoices", invoices, "due", "asc");
export const CUSTOMER_DESPATCHES_LIST = recordSource("milling-customer-despatches", "Customer despatches", customerDespatches, "date", "desc");
export const ROUTE_STOPS_LIST = recordSource("milling-route-stops", "Route stops", routeStops, "stop", "asc");
