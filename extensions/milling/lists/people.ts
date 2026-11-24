import type { ListSpec, ReportDefinition } from "@/lib/reports/types";

import { LIST_BASE, mill, MILL_VIEW } from "./shared";

/** Production › Plan: what each shift is to make, the maize it needs, and where its approval stands. */
const plans: ListSpec = {
  noun: "plans",
  read: MILL_VIEW,
  search: { placeholder: "Search plans", keys: ["code", "products", "supervisor"] },
  tabs: [
    { key: "approve", label: "To approve", where: [{ column: "stateKey", op: "is", value: ["SUBMITTED"] }], empty: "No plan is waiting for approval." },
    { key: "draft", label: "Drafts", where: [{ column: "stateKey", op: "is", value: ["DRAFT"] }] },
    { key: "approved", label: "Approved", where: [{ column: "stateKey", op: "is", value: ["APPROVED", "IN_PROGRESS"] }] },
    { key: "done", label: "Done", where: [{ column: "stateKey", op: "is", value: ["COMPLETED", "CLOSED"] }] },
    { key: "all", label: "All", where: [] },
  ],
  filters: [
    { key: "date", label: "Day", type: "period", any: "Any time", column: "date", primary: true, default: "any" },
    { key: "shift", label: "Shift", type: "choice", any: "Any", primary: true, options: [{ value: "Day", label: "Day" }, { value: "Night", label: "Night" }], column: "shift" },
  ],
  sorts: [{ key: "day", label: "Day, newest first", rules: [{ column: "date", dir: "desc" }, { column: "code", dir: "desc" }] }],
  groups: ["shift", "state"],
  columns: [
    { key: "code", label: "Plan", kind: "code", cell: "ref", width: "150px", align: "start", priority: 1 },
    { key: "date", label: "Day", kind: "date", cell: "date", dayFormat: "medium", width: "120px", align: "start", priority: 1 },
    { key: "shift", label: "Shift", kind: "text", cell: "text", width: "80px", align: "start", priority: 1 },
    { key: "state", label: "State", kind: "status", cell: "state", tones: { Draft: "hollow", "To approve": "warn", Approved: "info", Running: "info", Done: "ok", Cancelled: "hollow" }, width: "120px", align: "start", priority: 1 },
    { key: "products", label: "To make", kind: "text", cell: "muted", width: "minmax(200px,1.6fr)", align: "start", priority: 2 },
    { key: "maizeKg", label: "Maize needed kg", kind: "number", cell: "num", total: "sum", width: "140px", align: "end", priority: 1 },
    { key: "short", label: "Short", kind: "status", cell: "dot", tones: { "Approved short": "warn" }, empty: "blank", width: "130px", align: "start", priority: 3 },
    { key: "supervisor", label: "Supervisor", kind: "text", cell: "text", width: "minmax(130px,1fr)", align: "start", priority: 3 },
  ],
  rowHref: "/milling/plan/{id}",
  rowMenu: [{ key: "open", label: "Open", requires: MILL_VIEW, do: { href: "/milling/plan/{id}" } }],
  bulk: [
    {
      key: "approve",
      label: "Approve",
      requires: mill("plan.approve"),
      when: [{ column: "stateKey", op: "is", value: ["SUBMITTED"] }],
      do: { confirm: { title: "Approve these plans?", body: "Each reserves its maize and packaging, oldest lots first. One short of maize is not approved here: open it to approve it short.", confirm: "Approve" }, endpoint: "/api/milling/plans/approve" },
    },
    { key: "send-back", label: "Send back", requires: mill("plan.approve"), when: [{ column: "stateKey", op: "is", value: ["SUBMITTED"] }], do: { sheet: "mill-plan-send-back" } },
    { key: "export" },
  ],
  primary: { label: "Plan production", icon: "plus", requires: mill("plan.edit"), sheet: "mill-plan-new" },
  card: { title: "code", badge: "state", figure: "maizeKg", meta: "{dateText} · {shift}", meta2: "{products}" },
  empty: {
    icon: "CalendarBlank",
    title: "No plans yet",
    line: "A plan says what a shift is to make. Submitted, it works out the maize and packaging; approved, it reserves them.",
    primary: { label: "Plan production", sheet: "mill-plan-new", requires: mill("plan.edit") },
  },
};

/** Production › Shifts: each day and night shift, its crew and where its sign-off stands. */
const shifts: ListSpec = {
  noun: "shifts",
  read: MILL_VIEW,
  search: { placeholder: "Search shifts", keys: ["code", "supervisor"] },
  tabs: [
    { key: "now", label: "Planned and open", where: [{ column: "stateKey", op: "is", value: ["PLANNED", "OPEN"] }], empty: "No shift is planned or open." },
    { key: "approve", label: "To approve", where: [{ column: "stateKey", op: "is", value: ["CLOSED"] }], empty: "No closed shift is waiting." },
    { key: "approved", label: "Approved", where: [{ column: "stateKey", op: "is", value: ["APPROVED"] }] },
    { key: "all", label: "All", where: [] },
  ],
  filters: [
    { key: "date", label: "Day", type: "period", any: "Any time", column: "date", primary: true, default: "any" },
    { key: "kind", label: "Shift", type: "choice", any: "Any", primary: true, options: [{ value: "Day", label: "Day" }, { value: "Night", label: "Night" }], column: "kind" },
  ],
  sorts: [{ key: "newest", label: "Newest first", rules: [{ column: "startsAt", dir: "desc" }] }],
  groups: ["kind", "state", "supervisor"],
  columns: [
    { key: "code", label: "Shift", kind: "code", cell: "ref", width: "150px", align: "start", priority: 1 },
    { key: "kind", label: "Kind", kind: "text", cell: "text", width: "80px", align: "start", priority: 1 },
    { key: "state", label: "State", kind: "status", cell: "state", tones: { Planned: "hollow", Open: "info", "To approve": "warn", Approved: "ok" }, width: "120px", align: "start", priority: 1 },
    { key: "starts", label: "Starts", kind: "text", cell: "mono", width: "130px", align: "start", priority: 1 },
    { key: "supervisor", label: "Supervisor", kind: "text", cell: "text", width: "minmax(140px,1fr)", align: "start", priority: 2 },
    { key: "crew", label: "Crew", kind: "number", cell: "num", width: "80px", align: "end", priority: 1 },
    { key: "present", label: "Present", kind: "number", cell: "num", width: "90px", align: "end", priority: 2 },
    { key: "startsAt", label: "Starts at", kind: "date", cell: "date", hidden: true, width: "150px", align: "end", priority: 3 },
  ],
  rowHref: "/milling/shifts/{id}",
  rowMenu: [{ key: "open", label: "Open", requires: MILL_VIEW, do: { href: "/milling/shifts/{id}" } }],
  bulk: [
    {
      key: "approve",
      label: "Approve",
      requires: mill("shift.approve"),
      when: [{ column: "stateKey", op: "is", value: ["CLOSED"] }],
      do: { confirm: { title: "Approve these shifts?", body: "Their attendance and overtime go to People for the pay run.", confirm: "Approve" }, endpoint: "/api/milling/shifts/approve" },
    },
    { key: "export" },
  ],
  primary: { label: "Plan a shift", icon: "plus", requires: mill("shift.manage"), sheet: "mill-shift-new" },
  card: { title: "code", badge: "state", figure: "crew", meta: "{kind} · {starts}", meta2: "{supervisor}" },
  empty: {
    icon: "UsersThree",
    title: "No shifts yet",
    line: "A shift is the crew on the line for a day or a night. Approved, it writes their attendance and overtime for the pay run.",
    primary: { label: "Plan a shift", sheet: "mill-shift-new", requires: mill("shift.manage") },
  },
};

const def = (key: string, title: string, href: string, list: ListSpec, sort: string): ReportDefinition => ({
  ...LIST_BASE,
  key,
  title,
  href,
  params: [],
  columns: list.columns,
  defaults: { sort: [{ column: sort, dir: "desc" }] },
  list,
});

export const PLANS_LIST = def("milling-plan-list", "Plans", "/milling/plan", plans, "date");
export const SHIFTS_LIST = def("milling-shift-list", "Shifts", "/milling/shifts", shifts, "startsAt");
