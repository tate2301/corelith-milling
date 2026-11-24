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
