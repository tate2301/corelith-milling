import type { ListSpec, ReportDefinition } from "@/lib/reports/types";

import { LIST_BASE, mill, MILL_VIEW } from "./shared";

/**
 * Intake (canvas IN-A1): the day's weighbridge tickets by state. Each row is
 * a delivery: the truck, the supplier and their delivery note, its state,
 * the payable kilograms and what they are worth, who typed it and when. The
 * totals are the kilograms and value of the filtered tickets.
 */
const intake: ListSpec = {
  noun: "tickets",
  read: MILL_VIEW,
  search: { placeholder: "Search tickets", keys: ["code", "truck", "supplier", "deliveryRef", "typedBy"] },
  tabs: [
    { key: "qc", label: "Awaiting QC", where: [{ column: "stateKey", op: "is", value: ["AWAITING_QC"] }], empty: "Nothing is waiting for its sample." },
    { key: "held", label: "Held", where: [{ column: "stateKey", op: "is", value: ["HELD"] }], empty: "Nothing is held." },
    { key: "accepted", label: "Accepted", where: [{ column: "stateKey", op: "is", value: ["ACCEPTED"] }] },
    { key: "rejected", label: "Rejected", where: [{ column: "stateKey", op: "is", value: ["REJECTED"] }] },
    { key: "all", label: "All", where: [] },
  ],
  filters: [
    { key: "date", label: "Date", type: "period", any: "Any time", column: "date", primary: true, default: "today" },
    { key: "supplier", label: "Supplier", type: "choice", any: "Any", primary: true, optionsFromLoader: true, column: "supplier" },
    {
      key: "weight",
      label: "Weight",
      type: "choice",
      any: "Any",
      options: [
        { value: "provisional", label: "Provisional", where: [{ column: "weightKey", op: "is", value: ["PROVISIONAL"] }] },
        { value: "verified", label: "Verified", where: [{ column: "weightKey", op: "is", value: ["VERIFIED"] }] },
      ],
    },
    { key: "method", label: "Weighed by", type: "choice", any: "Any", optionsFromLoader: true, column: "method" },
  ],
  sorts: [
    {
      key: "newest",
      label: "Newest first",
      rules: [
        { column: "receivedAt", dir: "desc" },
        { column: "code", dir: "desc" },
      ],
    },
    { key: "heaviest", label: "Heaviest first", rules: [{ column: "netKg", dir: "desc" }] },
    { key: "supplier", label: "Supplier A–Z", rules: [{ column: "supplier", dir: "asc" }] },
  ],
  groups: ["supplier", "state", "method"],
  columns: [
    { key: "code", label: "Ticket", kind: "code", cell: "ref", width: "132px", align: "start", priority: 1 },
    { key: "truck", label: "Truck", kind: "text", cell: "mono", width: "112px", align: "start", priority: 2 },
    { key: "supplier", label: "Supplier", kind: "text", cell: "text", width: "minmax(200px,1.4fr)", align: "start", priority: 1 },
    { key: "deliveryRef", label: "Their note", kind: "code", cell: "mono", width: "110px", align: "start", priority: 3 },
    {
      key: "state",
      label: "State",
      kind: "status",
      cell: "state",
      tones: { "Awaiting QC": "pending", Held: "warn", Accepted: "ok", Rejected: "bad", Cancelled: "hollow" },
      width: "130px",
      align: "start",
      priority: 1,
    },
    { key: "weight", label: "Weight", kind: "status", cell: "dot", tones: { Provisional: "warn", Verified: "ok" }, hidden: true, width: "120px", align: "start", priority: 3 },
    { key: "netKg", label: "Payable kg", kind: "number", cell: "num", total: "sum", width: "120px", align: "end", priority: 1 },
    { key: "value", label: "Value", kind: "money", cell: "money", currency: "USD", total: "sum", width: "120px", align: "end", priority: 2 },
    { key: "typedBy", label: "Typed by", kind: "text", cell: "text", width: "minmax(140px,1fr)", align: "start", priority: 3 },
    { key: "receivedAt", label: "Received at", kind: "date", cell: "date", hidden: true, width: "150px", align: "end", priority: 3 },
    { key: "time", label: "Time", kind: "text", cell: "mono", width: "80px", align: "end", priority: 2 },
  ],
  rowHref: "/milling/intake/{id}",
  rowMenu: [{ key: "open", label: "Open", requires: MILL_VIEW, do: { href: "/milling/intake/{id}" } }],
  bulk: [{ key: "export" }],
  primary: { label: "New ticket", icon: "plus", requires: mill("intake.record"), href: "/milling/intake/new" },
  card: { title: "code", badge: "state", figure: "netKg", meta: "{supplier} · {truck}", meta2: "{time} · {typedBy}" },
  empty: {
    icon: "Scales",
    title: "No tickets yet",
    line: "A ticket is one truck of maize: its weights, the supplier and the sample QC takes from it.",
    primary: { label: "New ticket", href: "/milling/intake/new", requires: mill("intake.record") },
  },
};

export const INTAKE_LIST: ReportDefinition = {
  ...LIST_BASE,
  key: "milling-intake-list",
  title: "Intake",
  href: "/milling/intake",
  params: [],
  columns: intake.columns,
  defaults: { sort: [{ column: "receivedAt", dir: "desc" }] },
  list: intake,
};
