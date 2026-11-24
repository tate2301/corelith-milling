import type { ListSpec, ReportDefinition } from "@/lib/reports/types";

import { LIST_BASE, mill, MILL_VIEW } from "./shared";

/**
 * Despatch › Trips (canvas DS-B1): each vehicle run once it has left, with
 * the stops it delivered and its fuel. Tabs by state, then Date, Route and
 * Vehicle; the totals are the kilometres, the litres and km a litre over the
 * filtered trips. A row opens the trip.
 */
const trips: ListSpec = {
  noun: "trips",
  read: MILL_VIEW,
  search: { placeholder: "Search trips", keys: ["code", "route", "vehicle", "driver"] },
  tabs: [
    { key: "all", label: "All", where: [] },
    { key: "out", label: "Out", where: [{ column: "stateKey", op: "is", value: ["OUT"] }], empty: "No vehicle is out." },
    { key: "closed", label: "Closed", where: [{ column: "stateKey", op: "is", value: ["CLOSED"] }] },
  ],
  filters: [
    { key: "onRoute", type: "parent", column: "routeId" },
    { key: "date", label: "Date", type: "period", any: "Any time", column: "date", primary: true, default: "this-week" },
    { key: "route", label: "Route", type: "choice", any: "Any", primary: true, optionsFromLoader: true, column: "routeId" },
    { key: "vehicle", label: "Vehicle", type: "choice", any: "Any", primary: true, optionsFromLoader: true, column: "vehicle" },
    { key: "driver", label: "Driver", type: "choice", any: "Anyone", optionsFromLoader: true, column: "driver" },
  ],
  sorts: [
    {
      key: "newest",
      label: "Newest first",
      rules: [
        { column: "date", dir: "desc" },
        { column: "code", dir: "desc" },
      ],
    },
    { key: "km", label: "Most kilometres", rules: [{ column: "km", dir: "desc" }] },
    { key: "economy", label: "Fewest km a litre", rules: [{ column: "kmPerLitre", dir: "asc" }] },
  ],
  groups: ["route", "vehicle", "driver", "state"],
  columns: [
    { key: "code", label: "Trip", kind: "code", cell: "ref", width: "112px", align: "start", priority: 1 },
    { key: "route", label: "Route", kind: "code", cell: "ref", href: "/milling/routes/{routeId}", width: "96px", align: "start", priority: 1 },
    { key: "vehicle", label: "Vehicle", kind: "text", cell: "mono", width: "120px", align: "start", priority: 2 },
    { key: "driver", label: "Driver", kind: "text", cell: "text", width: "minmax(150px,1fr)", align: "start", priority: 2 },
    { key: "state", label: "State", kind: "status", cell: "state", tones: { Out: "info", Closed: "ok" }, width: "110px", align: "start", priority: 1 },
    { key: "date", label: "Date", kind: "date", cell: "date", dayFormat: "medium", width: "120px", align: "end", priority: 1 },
    { key: "delivered", label: "Delivered", kind: "text", cell: "mono", width: "100px", align: "end", priority: 2 },
    { key: "km", label: "Kilometres", kind: "number", cell: "num", total: "sum", width: "110px", align: "end", priority: 1 },
    { key: "litres", label: "Litres", kind: "number", cell: "num", total: "sum", width: "90px", align: "end", priority: 2 },
    { key: "kmPerLitre", label: "Km a litre", kind: "number", cell: "num", total: "avg", width: "100px", align: "end", priority: 3 },
  ],
  rowHref: "/milling/deliveries/{id}",
  rowMenu: [{ key: "open", label: "Open", requires: MILL_VIEW, do: { href: "/milling/deliveries/{id}" } }],
  bulk: [{ key: "export" }],
  primary: { label: "New trip", icon: "plus", requires: mill("delivery.manage"), sheet: "mill-despatch-new" },
  card: { title: "code", badge: "state", figure: "km", meta: "{route} · {vehicle}", meta2: "{dateText} · {delivered} delivered" },
  empty: {
    icon: "Truck",
    title: "No trips yet",
    line: "A trip starts when despatch notes leave on a vehicle. Its stops, kilometres and fuel show here.",
    primary: { label: "Start a trip", sheet: "mill-despatch-new", requires: mill("delivery.manage") },
  },
};

export const TRIPS_LIST: ReportDefinition = {
  ...LIST_BASE,
  key: "milling-trip-list",
  title: "Trips",
  href: "/milling/trips",
  params: [],
  columns: trips.columns,
  defaults: { sort: [{ column: "date", dir: "desc" }] },
  list: trips,
};
