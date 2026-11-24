import type { ListSpec, ReportDefinition } from "@/lib/reports/types";

import { LIST_BASE, mill, MILL_VIEW } from "./shared";

/**
 * Production › Downtime (canvas DT-A1): each stop on the line, the machine,
 * what stopped it and its kind, the run it hit, and how long it lasted. A
 * breakdown takes the machine out of use until a supervisor releases it.
 */
const downtime: ListSpec = {
  noun: "stops",
  read: MILL_VIEW,
  search: { placeholder: "Search downtime", keys: ["machine", "cause", "run"] },
  tabs: [
    { key: "all", label: "All", where: [] },
    { key: "stopped", label: "Stopped", where: [{ column: "stateKey", op: "is", value: ["OPEN"] }], empty: "Nothing is stopped." },
    { key: "closed", label: "Closed", where: [{ column: "stateKey", op: "is", value: ["CLOSED"] }] },
  ],
  filters: [
    { key: "date", label: "Date", type: "period", any: "Any time", column: "date", primary: true, default: "this-week" },
    { key: "machine", label: "Machine", type: "choice", any: "Any", primary: true, optionsFromLoader: true, column: "machine" },
    {
      key: "category",
      label: "Category",
      type: "choice",
      any: "Any",
      primary: true,
      options: ["Breakdown", "Power", "No maize", "Planned", "Other"].map((value) => ({ value, label: value })),
      column: "category",
    },
  ],
  sorts: [
    { key: "newest", label: "Newest first", rules: [{ column: "startedAt", dir: "desc" }] },
    { key: "longest", label: "Longest first", rules: [{ column: "hours", dir: "desc" }] },
  ],
  groups: ["machine", "category", "state"],
  columns: [
    { key: "machine", label: "Machine", kind: "text", cell: "text", strong: true, width: "minmax(150px,1fr)", align: "start", priority: 1 },
    { key: "cause", label: "What stopped", kind: "text", cell: "text", width: "minmax(200px,1.6fr)", align: "start", priority: 1 },
    { key: "category", label: "Category", kind: "text", cell: "muted", width: "110px", align: "start", priority: 2 },
    { key: "run", label: "Run", kind: "code", cell: "ref", href: "/milling/production/{runId}", width: "130px", align: "start", priority: 2 },
    { key: "state", label: "State", kind: "status", cell: "state", tones: { Stopped: "bad", Closed: "ok" }, width: "100px", align: "start", priority: 1 },
    { key: "from", label: "From", kind: "text", cell: "mono", width: "110px", align: "end", priority: 1 },
    { key: "to", label: "To", kind: "text", cell: "mono", empty: "dash", width: "110px", align: "end", priority: 2 },
    { key: "hours", label: "Hours", kind: "number", cell: "num", total: "sum", width: "80px", align: "end", priority: 1 },
    { key: "end", label: "", kind: "text", cell: "action", action: "end", width: "72px", align: "end", priority: 1 },
    { key: "startedAt", label: "Started at", kind: "date", cell: "date", hidden: true, width: "150px", align: "end", priority: 3 },
  ],
  rowHref: ["/milling/production/{runId}", "/milling/maintenance"],
  rowMenu: [
    {
      key: "end",
      label: "End",
      requires: mill("fault.report"),
      when: [
        { column: "stateKey", op: "is", value: ["OPEN"] },
        { column: "category", op: "isNot", value: ["Breakdown"] },
      ],
      do: { confirm: { title: "End the stop now?", body: "The line runs again from now. A breakdown ends when the machine is released instead.", confirm: "End the stop" }, endpoint: "/api/milling/downtime/end-many" },
    },
  ],
  bulk: [{ key: "export" }],
  primary: { label: "Log downtime", icon: "plus", requires: mill("fault.report"), sheet: "mill-stop-new" },
  card: { title: "machine", badge: "state", figure: "hours", meta: "{cause}", meta2: "{from} · {category}" },
  empty: {
    icon: "Wrench",
    title: "No stops yet",
    line: "Every time the line stops, log it: the machine, what happened and since when. A breakdown raises a work order for the workshop.",
    primary: { label: "Log downtime", sheet: "mill-stop-new", requires: mill("fault.report") },
  },
};

/** Production › Generator log (canvas DT-B1): each run of a generator, its hour meter, hours, diesel and why it ran. */
const generator: ListSpec = {
  noun: "generator runs",
  read: MILL_VIEW,
  search: { placeholder: "Search the log", keys: ["generator", "reason"] },
  filters: [
    { key: "date", label: "Date", type: "period", any: "Any time", column: "date", primary: true, default: "this-month" },
    { key: "generator", label: "Generator", type: "choice", any: "Any", primary: true, optionsFromLoader: true, column: "generator" },
  ],
  sorts: [{ key: "newest", label: "Newest first", rules: [{ column: "startedAt", dir: "desc" }] }],
  groups: ["generator"],
  columns: [
    { key: "generator", label: "Generator", kind: "text", cell: "text", strong: true, width: "minmax(140px,1fr)", align: "start", priority: 1 },
    { key: "from", label: "From", kind: "text", cell: "mono", width: "110px", align: "end", priority: 1 },
    { key: "to", label: "To", kind: "text", cell: "mono", width: "110px", align: "end", priority: 1 },
    { key: "meterFrom", label: "Hour meter from", kind: "number", cell: "num", width: "140px", align: "end", priority: 3 },
    { key: "meterTo", label: "Hour meter to", kind: "number", cell: "num", width: "130px", align: "end", priority: 3 },
    { key: "hours", label: "Hours", kind: "number", cell: "num", total: "sum", width: "80px", align: "end", priority: 1 },
    { key: "litres", label: "Litres", kind: "number", cell: "num", total: "sum", width: "80px", align: "end", priority: 1 },
    { key: "perHour", label: "Litres an hour", kind: "number", cell: "num", total: "avg", width: "120px", align: "end", priority: 2 },
    { key: "reason", label: "Why", kind: "text", cell: "muted", width: "minmax(140px,1fr)", align: "start", priority: 2 },
    { key: "startedAt", label: "Started at", kind: "date", cell: "date", hidden: true, width: "150px", align: "end", priority: 3 },
  ],
  rowHref: "/milling/generator",
  bulk: [{ key: "export" }],
  primary: { label: "Log a run", icon: "plus", requires: mill("fuel.record"), sheet: "mill-generator-run" },
  card: { title: "generator", figure: "litres", meta: "{from} to {to}", meta2: "{hours} hours · {reason}" },
  empty: {
    icon: "Lightning",
    title: "No generator runs yet",
    line: "Each time a generator covers a power cut, log its hours and the diesel it used.",
    primary: { label: "Log a run", sheet: "mill-generator-run", requires: mill("fuel.record") },
  },
};

const def = (key: string, title: string, href: string, list: ListSpec): ReportDefinition => ({
  ...LIST_BASE,
  key,
  title,
  href,
  params: [],
  columns: list.columns,
  defaults: { sort: [{ column: "startedAt", dir: "desc" }] },
  list,
});

export const DOWNTIME_LIST = def("milling-downtime-list", "Downtime", "/milling/downtime", downtime);
export const GENERATOR_LIST = def("milling-generator-list", "Generator log", "/milling/generator", generator);
