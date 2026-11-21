import type { ListSpec, ReportDefinition } from "@/lib/reports/types";

import { LIST_BASE, mill, MILL_VIEW } from "./shared";

/**
 * Despatch › Despatches (canvas DS-A1): each despatch note with its
 * customers, state, bags, tonnes and value. Before it leaves it is planned,
 * then loading; once out it is a trip.
 */
const despatches: ListSpec = {
  noun: "despatch notes",
  read: MILL_VIEW,
  search: { placeholder: "Search despatches", keys: ["code", "customers", "vehicle", "driver", "destination"] },
  tabs: [
    { key: "all", label: "All", where: [] },
    { key: "planned", label: "Planned", where: [{ column: "stateKey", op: "is", value: ["PLANNED", "LOADING"] }], empty: "Nothing is waiting to load." },
    { key: "out", label: "Out", where: [{ column: "stateKey", op: "is", value: ["DISPATCHED"] }] },
    { key: "delivered", label: "Delivered", where: [{ column: "stateKey", op: "is", value: ["DELIVERED"] }] },
    { key: "closed", label: "Closed", where: [{ column: "stateKey", op: "is", value: ["CLOSED"] }] },
  ],
  filters: [
    { key: "date", label: "Date", type: "period", any: "Any time", column: "date", primary: true, default: "any" },
    { key: "customer", label: "Customer", type: "choice", any: "Any", primary: true, optionsFromLoader: true, column: "firstCustomer" },
    { key: "vehicle", label: "Vehicle", type: "choice", any: "Any", optionsFromLoader: true, column: "vehicle" },
  ],
  sorts: [{ key: "newest", label: "Newest first", rules: [{ column: "createdAt", dir: "desc" }] }],
  groups: ["state", "vehicle", "destination"],
  columns: [
    { key: "code", label: "Note", kind: "code", cell: "ref", width: "140px", align: "start", priority: 1 },
    { key: "customers", label: "Customer", kind: "text", cell: "text", width: "minmax(220px,1.6fr)", align: "start", priority: 1 },
    { key: "state", label: "State", kind: "status", cell: "state", tones: { Planned: "pending", Loading: "info", Out: "info", Delivered: "warn", Closed: "ok", Cancelled: "hollow" }, width: "110px", align: "start", priority: 1 },
    { key: "vehicle", label: "Vehicle", kind: "text", cell: "mono", width: "110px", align: "start", priority: 2 },
    { key: "bags", label: "Bags", kind: "number", cell: "num", total: "sum", width: "90px", align: "end", priority: 1 },
    { key: "tonnes", label: "Tonnes", kind: "number", cell: "num", total: "sum", width: "90px", align: "end", priority: 1 },
    { key: "createdAt", label: "Created", kind: "date", cell: "date", hidden: true, width: "150px", align: "end", priority: 3 },
    { key: "issued", label: "Issued", kind: "text", cell: "mono", width: "110px", align: "end", priority: 2 },
  ],
  rowHref: "/milling/deliveries/{id}",
  rowMenu: [{ key: "open", label: "Open", requires: MILL_VIEW, do: { href: "/milling/deliveries/{id}" } }],
  bulk: [{ key: "export" }],
  primary: { label: "New despatch note", icon: "plus", requires: mill("delivery.manage"), sheet: "mill-despatch-new" },
  card: { title: "code", badge: "state", figure: "bags", meta: "{customers}", meta2: "{vehicle} · {issued}" },
  empty: {
    icon: "Truck",
    title: "No despatch notes yet",
    line: "A despatch note takes confirmed orders onto a truck. It leaves as a trip and comes back with what was delivered.",
    primary: { label: "New despatch note", sheet: "mill-despatch-new", requires: mill("delivery.manage") },
  },
};

/** Despatch › Routes (canvas DS-B2): the routes the trucks run, their stops, days and usual vehicle. */
const routes: ListSpec = {
  noun: "routes",
  read: MILL_VIEW,
  search: { placeholder: "Search routes", keys: ["code", "name", "areas", "vehicle"] },
  filters: [
    {
      key: "show",
      label: "Show",
      type: "choice",
      any: "Both",
      default: "running",
      options: [
        { value: "running", label: "Running", where: [{ column: "stateKey", op: "is", value: ["ACTIVE"] }] },
        { value: "stopped", label: "Stopped", where: [{ column: "stateKey", op: "is", value: ["STOPPED"] }] },
      ],
    },
  ],
  sorts: [{ key: "code", label: "Code", rules: [{ column: "code", dir: "asc" }] }],
  columns: [
    { key: "code", label: "Route", kind: "code", cell: "ref", width: "90px", align: "start", priority: 1 },
    { key: "name", label: "Name", kind: "text", cell: "link", width: "minmax(160px,1fr)", align: "start", priority: 1 },
    { key: "areas", label: "Areas", kind: "text", cell: "muted", width: "minmax(160px,1.2fr)", align: "start", priority: 2 },
    { key: "stops", label: "Stops", kind: "number", cell: "num", total: "sum", width: "80px", align: "end", priority: 1 },
    { key: "days", label: "Days", kind: "text", cell: "text", width: "140px", align: "start", priority: 2 },
    { key: "vehicle", label: "Vehicle", kind: "text", cell: "mono", width: "110px", align: "start", priority: 2 },
    { key: "km", label: "Last trip km", kind: "number", cell: "num", width: "110px", align: "end", priority: 3 },
  ],
  rowHref: "/milling/routes/{id}",
  bulk: [{ key: "export" }],
  primary: { label: "New route", icon: "plus", requires: mill("delivery.manage"), sheet: "mill-route-new" },
  card: { title: "name", badge: "code", figure: "stops", meta: "{areas}", meta2: "{days} · {vehicle}" },
  empty: {
    icon: "MapTrifold",
    title: "No routes yet",
    line: "A route is the shops a truck visits on its days, in order. Trips and the rep's day start from it.",
    primary: { label: "New route", sheet: "mill-route-new", requires: mill("delivery.manage") },
  },
};

/** Despatch › Orders: what customers ordered, the bags and kilograms, and how far each has gone. */
const orders: ListSpec = {
  noun: "orders",
  read: MILL_VIEW,
  search: { placeholder: "Search orders", keys: ["code", "customer", "destination", "products"] },
  tabs: [
    { key: "open", label: "Open", where: [{ column: "stateKey", op: "is", value: ["DRAFT", "CONFIRMED", "IN_DELIVERY"] }], empty: "No order is waiting." },
    { key: "delivered", label: "Delivered", where: [{ column: "stateKey", op: "is", value: ["DELIVERED", "CLOSED"] }] },
    { key: "all", label: "All", where: [] },
  ],
  filters: [
    { key: "date", label: "Needed", type: "period", any: "Any time", column: "date", primary: true, default: "any" },
    { key: "customer", label: "Customer", type: "choice", any: "Any", primary: true, optionsFromLoader: true, column: "customer" },
  ],
  sorts: [{ key: "newest", label: "Newest first", rules: [{ column: "createdAt", dir: "desc" }] }],
  groups: ["customer", "state", "destination"],
  columns: [
    { key: "code", label: "Order", kind: "code", cell: "ref", width: "140px", align: "start", priority: 1 },
    { key: "customer", label: "Customer", kind: "text", cell: "text", width: "minmax(180px,1.4fr)", align: "start", priority: 1 },
    { key: "products", label: "Products", kind: "text", cell: "muted", width: "minmax(160px,1.2fr)", align: "start", priority: 3 },
    { key: "state", label: "State", kind: "status", cell: "state", tones: { Draft: "hollow", Confirmed: "info", "On a truck": "info", Delivered: "ok", Closed: "ok", Cancelled: "hollow" }, width: "120px", align: "start", priority: 1 },
    { key: "bags", label: "Bags", kind: "number", cell: "num", total: "sum", width: "80px", align: "end", priority: 1 },
    { key: "kg", label: "Kg", kind: "number", cell: "num", total: "sum", width: "100px", align: "end", priority: 2 },
    { key: "createdAt", label: "Taken", kind: "date", cell: "date", hidden: true, width: "150px", align: "end", priority: 3 },
    { key: "needed", label: "Needed", kind: "date", cell: "date", dayFormat: "medium", width: "120px", align: "end", priority: 2 },
  ],
  rowHref: "/milling/orders?order={id}",
  bulk: [{ key: "export" }],
  primary: { label: "New order", icon: "plus", requires: mill("order.manage"), href: "/milling/orders?new=1" },
  card: { title: "customer", badge: "state", figure: "bags", meta: "{code} · {products}", metaMono: ["code"] },
  empty: {
    icon: "ClipboardText",
    title: "No orders yet",
    line: "An order is what a customer wants and when. Confirmed orders reserve the oldest bags and go out on a despatch note.",
    primary: { label: "New order", href: "/milling/orders?new=1", requires: mill("order.manage") },
  },
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

export const DESPATCHES_LIST = def("milling-despatch-list", "Despatches", "/milling/deliveries", despatches, "createdAt", "desc");
export const ROUTES_LIST = def("milling-route-list", "Routes", "/milling/routes", routes, "code", "asc");
export const ORDERS_LIST = def("milling-order-list", "Orders", "/milling/orders", orders, "createdAt", "desc");
