import type { ListGrant, ListSpec, ReportDefinition } from "@/lib/reports/types";

/**
 * Assets (maintenance) on core's ListFrame, drawn as Stock and Books are:
 * the machines and vehicles, their work orders, the preventive plans that
 * keep them running, the technicians who do the work, and the fuel they
 * burn. Grants are the maintenance features (lib/platform/feature-grants.ts).
 */

const EQUIPMENT: ListGrant[] = [["maintenance.equipment", "view"]];
const EQUIPMENT_EDIT: ListGrant[] = [["maintenance.equipment", "update"]];
const ORDERS: ListGrant[] = [["maintenance.work-orders", "view"]];
const ORDERS_EDIT: ListGrant[] = [["maintenance.work-orders", "update"]];
const BREAKDOWN: ListGrant[] = [["maintenance.breakdowns", "create"]];
const PLANS: ListGrant[] = [["maintenance.schedule", "view"]];
const PLANS_EDIT: ListGrant[] = [["maintenance.schedule", "update"]];

const base = (key: string, title: string, href: string, featureKey: string, list: ListSpec, sort: { column: string; dir: "asc" | "desc" }): ReportDefinition => ({
  key,
  title,
  area: "Assets",
  href,
  featureKey,
  profiles: [],
  params: [],
  columns: list.columns,
  defaults: { sort: [sort] },
  list,
});

/** Machinery and vehicles: the register, a tab each, with what each is doing now and its next service. */
const equipment: ListSpec = {
  noun: "machines and vehicles",
  read: EQUIPMENT,
  search: { placeholder: "Search machinery and vehicles", keys: ["code", "name", "category", "registration", "make"] },
  tabs: [
    { key: "machines", label: "Machinery", where: [{ column: "kindKey", op: "is", value: ["MACHINE"] }, { column: "activeKey", op: "is", value: ["yes"] }], empty: "No machinery in the register yet." },
    { key: "vehicles", label: "Vehicles", where: [{ column: "kindKey", op: "is", value: ["VEHICLE"] }, { column: "activeKey", op: "is", value: ["yes"] }], empty: "No vehicles in the register yet." },
    { key: "down", label: "Down", where: [{ column: "stateKey", op: "is", value: ["DOWN"] }], empty: "Nothing is down." },
    { key: "retired", label: "Retired", where: [{ column: "activeKey", op: "is", value: ["no"] }], empty: "Nothing has been retired." },
  ],
  filters: [
    { key: "category", label: "Kind", type: "choice", any: "Any", primary: true, optionsFromLoader: true, column: "category" },
    { key: "site", label: "Site", type: "choice", any: "Any site", primary: true, optionsFromLoader: true, column: "site" },
  ],
  sorts: [
    { key: "code", label: "Code", rules: [{ column: "code", dir: "asc" }] },
    { key: "service", label: "Next service first", rules: [{ column: "nextServiceAt", dir: "asc" }] },
  ],
  groups: ["category", "site", "state"],
  columns: [
    { key: "code", label: "Code", kind: "code", cell: "mono", width: "110px", align: "start", priority: 1 },
    { key: "name", label: "Name", kind: "text", cell: "link", width: "minmax(180px,1.4fr)", align: "start", priority: 1 },
    { key: "category", label: "Kind", kind: "text", cell: "muted", width: "130px", align: "start", priority: 2 },
    { key: "registration", label: "Plate", kind: "code", cell: "mono", width: "110px", align: "start", priority: 2 },
    { key: "state", label: "State", kind: "status", cell: "state", tones: { Working: "ok", Down: "bad", "In service": "info", Retired: "hollow" }, width: "120px", align: "start", priority: 1 },
    { key: "meter", label: "Meter", kind: "text", cell: "mono", width: "120px", align: "end", priority: 2 },
    { key: "nextService", label: "Next service", kind: "text", cell: "text", width: "minmax(150px,1fr)", align: "start", priority: 2 },
    { key: "nextServiceAt", label: "Next service at", kind: "date", cell: "date", hidden: true, width: "130px", align: "end", priority: 3 },
    { key: "openOrders", label: "Open work", kind: "number", cell: "num", total: "sum", width: "100px", align: "end", priority: 2 },
    { key: "site", label: "Site", kind: "text", cell: "muted", width: "140px", align: "start", priority: 3 },
  ],
  rowHref: "/maintenance/equipment/{id}",
  rowMenu: [
    { key: "breakdown", label: "Log a breakdown", requires: BREAKDOWN, when: [{ column: "activeKey", op: "is", value: ["yes"] }], do: { sheet: "maint-breakdown", with: { equipment: "{id}" } } },
    { key: "meter", label: "Read the meter", requires: EQUIPMENT_EDIT, when: [{ column: "hasMeter", op: "is", value: ["yes"] }], do: { sheet: "maint-meter" } },
    { key: "edit", label: "Change details", requires: EQUIPMENT_EDIT, do: { sheet: "maint-equipment" } },
  ],
  bulk: [{ key: "export" }],
  primary: { label: "Add machinery or a vehicle", icon: "plus", requires: EQUIPMENT_EDIT, sheet: "maint-equipment" },
  card: { title: "name", badge: "state", figure: "meter", meta: "{code} · {category}", metaMono: ["code"], meta2: "{nextService}" },
  empty: { icon: "Wrench", title: "Nothing in the register yet", line: "Add each machine and vehicle: its code, where it is and what its meter counts.", primary: { label: "Add machinery or a vehicle", sheet: "maint-equipment", requires: EQUIPMENT_EDIT } },
};

/** Work orders: breakdowns and services, open first. */
const workOrders: ListSpec = {
  noun: "work orders",
  read: ORDERS,
  search: { placeholder: "Search work orders", keys: ["ref", "equipment", "issue", "technician"] },
  tabs: [
    { key: "open", label: "Open", where: [{ column: "stateKey", op: "is", value: ["OPEN", "IN_PROGRESS"] }], empty: "No open work orders." },
    { key: "done", label: "Done", where: [{ column: "stateKey", op: "is", value: ["COMPLETED"] }] },
    { key: "all", label: "All", where: [{ column: "stateKey", op: "isNot", value: ["DRAFT"] }] },
    { key: "drafts", label: "Vane's drafts", where: [{ column: "stateKey", op: "is", value: ["DRAFT"] }], empty: "Vane has drafted nothing." },
  ],
  filters: [
    { key: "equipment", type: "parent", column: "equipmentId" },
    { key: "plan", type: "parent", column: "planId" },
    {
      key: "kind",
      label: "Kind",
      type: "choice",
      any: "Any",
      primary: true,
      options: [
        { value: "breakdown", label: "Breakdowns", where: [{ column: "kind", op: "is", value: ["Breakdown"] }] },
        { value: "service", label: "Services", where: [{ column: "kind", op: "is", value: ["Service"] }] },
      ],
    },
    { key: "technician", label: "Technician", type: "choice", any: "Anyone", primary: true, optionsFromLoader: true, column: "technician" },
    { key: "date", label: "Raised", type: "period", any: "Any time", column: "date", default: "any" },
  ],
  sorts: [
    { key: "newest", label: "Newest first", rules: [{ column: "raisedAt", dir: "desc" }] },
    { key: "urgent", label: "Most urgent", rules: [{ column: "urgency", dir: "desc" }, { column: "raisedAt", dir: "asc" }] },
  ],
  groups: ["equipment", "technician", "kind", "priority"],
  columns: [
    { key: "ref", label: "Work order", kind: "code", cell: "ref", width: "110px", align: "start", priority: 1 },
    { key: "equipment", label: "Machine or vehicle", kind: "text", cell: "text", strong: true, width: "minmax(160px,1.2fr)", align: "start", priority: 1 },
    { key: "issue", label: "Work", kind: "text", cell: "text", width: "minmax(200px,1.6fr)", align: "start", priority: 1 },
    { key: "kind", label: "Kind", kind: "status", cell: "dot", tones: { Breakdown: "bad", Service: "info" }, width: "110px", align: "start", priority: 2 },
    { key: "priority", label: "Priority", kind: "text", cell: "muted", width: "90px", align: "start", priority: 3 },
    { key: "state", label: "State", kind: "status", cell: "state", tones: { Open: "warn", "In progress": "info", Done: "ok", Cancelled: "hollow", Draft: "hollow" }, width: "120px", align: "start", priority: 1 },
    { key: "technician", label: "Technician", kind: "text", cell: "text", width: "minmax(130px,1fr)", align: "start", priority: 2 },
    { key: "when", label: "For", kind: "text", cell: "mono", width: "120px", align: "end", priority: 2 },
    { key: "downHours", label: "Down, h", kind: "number", cell: "num", total: "sum", width: "90px", align: "end", priority: 3 },
    { key: "cost", label: "Cost", kind: "money", cell: "money", currency: "USD", total: "sum", width: "110px", align: "end", priority: 2 },
    { key: "raisedAt", label: "Raised", kind: "date", cell: "date", hidden: true, width: "130px", align: "end", priority: 3 },
    { key: "urgency", label: "Urgency", kind: "number", cell: "num", hidden: true, width: "80px", align: "end", priority: 3 },
  ],
  rowHref: "/maintenance/work-orders/{id}",
  rowMenu: [
    { key: "start", label: "Start the work", requires: ORDERS_EDIT, when: [{ column: "stateKey", op: "is", value: ["OPEN"] }], do: { confirm: { title: "Start the work?", body: "It shows as in progress, with whoever is on it.", confirm: "Start" }, endpoint: "/api/maintenance/work-orders/start" } },
    { key: "complete", label: "Complete", requires: ORDERS_EDIT, when: [{ column: "stateKey", op: "is", value: ["OPEN", "IN_PROGRESS"] }], do: { sheet: "maint-complete" } },
  ],
  bulk: [{ key: "export" }],
  primary: { label: "Log a breakdown", icon: "plus", requires: BREAKDOWN, sheet: "maint-breakdown" },
  card: { title: "equipment", badge: "state", figure: "cost", meta: "{ref} · {kind} · {when}", metaMono: ["ref"], meta2: "{issue}" },
  empty: { icon: "Wrench", title: "No work orders", line: "A breakdown logged, or a service a plan raised, shows here until it is done.", primary: { label: "Log a breakdown", sheet: "maint-breakdown", requires: BREAKDOWN } },
};

/** Preventive plans: what is due, booked or fine, soonest first. */
const plans: ListSpec = {
  noun: "plans",
  read: PLANS,
  search: { placeholder: "Search plans", keys: ["equipment", "name", "technician"] },
  tabs: [
    { key: "due", label: "Due", where: [{ column: "stateKey", op: "is", value: ["OVERDUE", "DUE"] }], empty: "Nothing is due. Every service is booked or ahead." },
    { key: "booked", label: "Booked", where: [{ column: "stateKey", op: "is", value: ["BOOKED"] }], empty: "No service is booked." },
    { key: "all", label: "All", where: [{ column: "stateKey", op: "isNot", value: ["PAUSED"] }] },
    { key: "paused", label: "Paused", where: [{ column: "stateKey", op: "is", value: ["PAUSED"] }], empty: "No plan is paused." },
  ],
  filters: [{ key: "equipment", type: "parent", column: "equipmentId" }, { key: "technician", label: "Technician", type: "choice", any: "Anyone", primary: true, optionsFromLoader: true, column: "technician" }],
  sorts: [{ key: "soonest", label: "Soonest first", rules: [{ column: "nextDueAt", dir: "asc" }] }],
  groups: ["equipment", "technician", "state"],
  columns: [
    { key: "equipment", label: "Machine or vehicle", kind: "text", cell: "text", strong: true, width: "minmax(160px,1.2fr)", align: "start", priority: 1 },
    { key: "name", label: "Service", kind: "text", cell: "link", width: "minmax(180px,1.4fr)", align: "start", priority: 1 },
    { key: "every", label: "Every", kind: "text", cell: "text", width: "minmax(150px,1fr)", align: "start", priority: 2 },
    { key: "lastDone", label: "Last done", kind: "text", cell: "mono", width: "130px", align: "end", priority: 3 },
    { key: "nextDue", label: "Next due", kind: "text", cell: "mono", width: "minmax(150px,1fr)", align: "end", priority: 1 },
    { key: "state", label: "State", kind: "status", cell: "state", tones: { Overdue: "bad", Due: "warn", Booked: "info", Ahead: "ok", Paused: "hollow" }, width: "110px", align: "start", priority: 1 },
    { key: "technician", label: "Technician", kind: "text", cell: "text", width: "minmax(120px,1fr)", align: "start", priority: 3 },
    { key: "nextDueAt", label: "Next due at", kind: "date", cell: "date", hidden: true, width: "130px", align: "end", priority: 3 },
  ],
  rowHref: "/maintenance/schedule?sheet=maint-plan&id={id}",
  rowMenu: [
    { key: "book", label: "Book the service", requires: ORDERS_EDIT, when: [{ column: "stateKey", op: "is", value: ["OVERDUE", "DUE", "OK"] }], do: { sheet: "maint-book" } },
    { key: "edit", label: "Change the plan", requires: PLANS_EDIT, do: { sheet: "maint-plan" } },
    { key: "pause", label: "Pause", requires: PLANS_EDIT, when: [{ column: "stateKey", op: "isNot", value: ["PAUSED"] }], separated: true, do: { confirm: { title: "Pause the plan?", body: "It comes due no more, and raises nothing, until it is started again.", confirm: "Pause" }, endpoint: "/api/maintenance/plans/pause" } },
    { key: "resume", label: "Start again", requires: PLANS_EDIT, when: [{ column: "stateKey", op: "is", value: ["PAUSED"] }], do: { confirm: { title: "Start the plan again?", body: "Its next due is worked out from its last service.", confirm: "Start again" }, endpoint: "/api/maintenance/plans/resume" } },
  ],
  bulk: [{ key: "export" }],
  primary: { label: "Add a plan", icon: "plus", requires: PLANS_EDIT, sheet: "maint-plan" },
  card: { title: "name", badge: "state", figure: "", meta: "{equipment} · {every}", meta2: "Next {nextDue}" },
  empty: { icon: "Calendar", title: "No preventive plans yet", line: "A plan is a service a machine needs every so many days, hours or kilometres. Its next due is worked out for you.", primary: { label: "Add a plan", sheet: "maint-plan", requires: PLANS_EDIT } },
};

/** Technicians: who does the work, their trade and what is on their plate. */
const technicians: ListSpec = {
  noun: "technicians",
  read: ORDERS,
  search: { placeholder: "Search technicians", keys: ["name", "trade"] },
  tabs: [
    { key: "active", label: "Working", where: [{ column: "activeKey", op: "is", value: ["yes"] }], empty: "No technicians yet." },
    { key: "left", label: "No longer", where: [{ column: "activeKey", op: "is", value: ["no"] }], empty: "Nobody has stopped." },
  ],
  filters: [{ key: "trade", label: "Trade", type: "choice", any: "Any", primary: true, optionsFromLoader: true, column: "trade" }],
  sorts: [{ key: "name", label: "Name A–Z", rules: [{ column: "name", dir: "asc" }] }],
  columns: [
    { key: "name", label: "Technician", kind: "text", cell: "link", width: "minmax(180px,1.4fr)", align: "start", priority: 1 },
    { key: "trade", label: "Trade", kind: "text", cell: "text", width: "minmax(140px,1fr)", align: "start", priority: 1 },
    { key: "rate", label: "An hour", kind: "money", cell: "money", currency: "USD", width: "110px", align: "end", priority: 2 },
    { key: "open", label: "Open work", kind: "number", cell: "num", total: "sum", width: "100px", align: "end", priority: 1 },
    { key: "doneMonth", label: "Done this month", kind: "number", cell: "num", total: "sum", width: "130px", align: "end", priority: 2 },
    { key: "plans", label: "Plans", kind: "number", cell: "num", width: "80px", align: "end", priority: 3 },
  ],
  rowHref: "/maintenance/work-orders?technician={name}",
  rowMenu: [{ key: "edit", label: "Change", requires: ORDERS_EDIT, do: { sheet: "maint-technician" } }],
  bulk: [{ key: "export" }],
  primary: { label: "Add a technician", icon: "plus", requires: ORDERS_EDIT, sheet: "maint-technician" },
  card: { title: "name", figure: "open", meta: "{trade}" },
  empty: { icon: "Users", title: "No technicians yet", line: "Make an employee a technician: their trade, and what an hour of their time costs a work order.", primary: { label: "Add a technician", sheet: "maint-technician", requires: ORDERS_EDIT } },
};

/** Fuel log: every issue of fuel to a machine or vehicle, with the meter it was at. */
const fuelLog: ListSpec = {
  noun: "fuel issues",
  read: EQUIPMENT,
  search: { placeholder: "Search fuel issues", keys: ["equipment", "fuel", "by", "reference"] },
  filters: [
    { key: "equipment", type: "parent", column: "equipmentId" },
    { key: "date", label: "Issued", type: "period", any: "Any time", column: "date", primary: true, default: "this-month" },
    { key: "machine", label: "Machine or vehicle", type: "choice", any: "Any", primary: true, optionsFromLoader: true, column: "equipment" },
    { key: "fuel", label: "Fuel", type: "choice", any: "Any", optionsFromLoader: true, column: "fuel" },
  ],
  sorts: [{ key: "newest", label: "Newest first", rules: [{ column: "issuedAt", dir: "desc" }] }],
  groups: ["equipment", "fuel"],
  columns: [
    { key: "when", label: "Issued", kind: "text", cell: "mono", width: "130px", align: "start", priority: 1 },
    { key: "equipment", label: "Machine or vehicle", kind: "text", cell: "text", strong: true, width: "minmax(170px,1.3fr)", align: "start", priority: 1 },
    { key: "fuel", label: "Fuel", kind: "text", cell: "text", width: "minmax(120px,1fr)", align: "start", priority: 2 },
    { key: "litres", label: "Litres", kind: "number", cell: "num", total: "sum", width: "100px", align: "end", priority: 1 },
    { key: "meter", label: "Meter", kind: "text", cell: "mono", width: "120px", align: "end", priority: 2 },
    { key: "cost", label: "Cost", kind: "money", cell: "money", currency: "USD", total: "sum", width: "110px", align: "end", priority: 2 },
    { key: "by", label: "Issued by", kind: "text", cell: "muted", width: "130px", align: "start", priority: 3 },
    { key: "reference", label: "Reference", kind: "code", cell: "mono", width: "120px", align: "start", priority: 3 },
    { key: "issuedAt", label: "Issued at", kind: "date", cell: "date", hidden: true, width: "130px", align: "end", priority: 3 },
  ],
  rowHref: "/maintenance/equipment/{equipmentId}",
  bulk: [{ key: "export" }],
  card: { title: "equipment", figure: "litres", meta: "{when} · {fuel}", meta2: "{meter}" },
  empty: { icon: "GasPump", title: "No fuel issued in these days", line: "Fuel issued from stores to a machine or vehicle, with its meter, shows here." },
};

/** Fuel usage: each machine's fuel month by month, against how far it went or how long it ran. */
const fuelUsage: ListSpec = {
  noun: "months of fuel",
  read: EQUIPMENT,
  search: { placeholder: "Search machinery and vehicles", keys: ["equipment"] },
  filters: [
    { key: "date", label: "Month", type: "period", any: "Any time", column: "date", primary: true, default: "this-year" },
    { key: "kindOf", label: "Kind", type: "choice", any: "Any", primary: true, options: [
      { value: "machines", label: "Machinery", where: [{ column: "kindKey", op: "is", value: ["MACHINE"] }] },
      { value: "vehicles", label: "Vehicles", where: [{ column: "kindKey", op: "is", value: ["VEHICLE"] }] },
    ] },
  ],
  sorts: [{ key: "month", label: "Latest month first", rules: [{ column: "date", dir: "desc" }] }],
  groups: ["equipment", "month"],
  defaultGroup: "equipment",
  columns: [
    { key: "equipment", label: "Machine or vehicle", kind: "text", cell: "text", strong: true, width: "minmax(170px,1.3fr)", align: "start", priority: 1 },
    { key: "month", label: "Month", kind: "text", cell: "mono", width: "110px", align: "start", priority: 1 },
    { key: "litres", label: "Litres", kind: "number", cell: "num", total: "sum", width: "100px", align: "end", priority: 1 },
    { key: "cost", label: "Cost", kind: "money", cell: "money", currency: "USD", total: "sum", width: "110px", align: "end", priority: 2 },
    { key: "km", label: "Km", kind: "number", cell: "num", total: "sum", width: "100px", align: "end", priority: 2 },
    { key: "hours", label: "Hours", kind: "number", cell: "num", total: "sum", width: "90px", align: "end", priority: 2 },
    { key: "per100km", label: "Litres / 100 km", kind: "number", cell: "num", ratio: { num: "litres", den: "km" }, total: "avg", width: "130px", align: "end", priority: 1 },
    { key: "perHour", label: "Litres / hour", kind: "number", cell: "num", total: "avg", width: "120px", align: "end", priority: 1 },
    { key: "date", label: "Month start", kind: "date", cell: "date", hidden: true, width: "120px", align: "end", priority: 3 },
  ],
  rowHref: "/maintenance/equipment/{equipmentId}",
  bulk: [{ key: "export" }],
  card: { title: "equipment", figure: "litres", meta: "{month}", meta2: "{per100km} l/100 km · {perHour} l/h" },
  empty: { icon: "GasPump", title: "No fuel in these months", line: "Each machine's fuel by month, against the kilometres it went or the hours it ran." },
};

export const MAINTENANCE_LISTS: ReportDefinition[] = [
  base("assets-equipment", "Machinery and vehicles", "/maintenance/equipment", "maintenance.equipment", equipment, { column: "code", dir: "asc" }),
  base("assets-work-orders", "Work orders", "/maintenance/work-orders", "maintenance.work-orders", workOrders, { column: "raisedAt", dir: "desc" }),
  base("assets-plans", "Preventive plans", "/maintenance/schedule/plans", "maintenance.schedule", plans, { column: "nextDueAt", dir: "asc" }),
  base("assets-technicians", "Technicians", "/maintenance/technicians", "maintenance.work-orders", technicians, { column: "name", dir: "asc" }),
  base("assets-fuel-log", "Fuel log", "/maintenance/fuel", "maintenance.equipment", fuelLog, { column: "issuedAt", dir: "desc" }),
  base("assets-fuel-usage", "Fuel usage", "/maintenance/fuel/usage", "maintenance.equipment", fuelUsage, { column: "date", dir: "desc" }),
];
