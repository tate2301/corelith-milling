import type { ListSpec, ReportDefinition } from "@/lib/reports/types";

import { LIST_BASE, mill, MILL_VIEW } from "./shared";

/**
 * Exceptions (F4): what is held up waiting for someone to decide — a failed
 * test, a breakdown, a count off, a load over the truck — oldest first, then
 * what was decided, by whom and why. Decide opens the decision sheet.
 */
const exceptions: ListSpec = {
  noun: "exceptions",
  read: MILL_VIEW,
  search: { placeholder: "Search exceptions", keys: ["code", "title", "type", "raisedBy"] },
  tabs: [
    { key: "open", label: "Open", where: [{ column: "stateKey", op: "is", value: ["OPEN"] }], empty: "Nothing is waiting for a decision." },
    { key: "decided", label: "Decided", where: [{ column: "stateKey", op: "is", value: ["DECIDED"] }] },
    { key: "all", label: "All", where: [] },
  ],
  filters: [
    { key: "date", label: "Raised", type: "period", any: "Any time", column: "date", primary: true, default: "any" },
    { key: "type", label: "Type", type: "choice", any: "Any", primary: true, optionsFromLoader: true, column: "type" },
    {
      key: "severity",
      label: "Severity",
      type: "choice",
      any: "Any",
      options: [
        { value: "high", label: "High", where: [{ column: "severity", op: "is", value: ["High"] }] },
        { value: "medium", label: "Medium", where: [{ column: "severity", op: "is", value: ["Medium"] }] },
        { value: "low", label: "Low", where: [{ column: "severity", op: "is", value: ["Low"] }] },
      ],
    },
  ],
  sorts: [
    { key: "oldest", label: "Oldest first", rules: [{ column: "raisedAt", dir: "asc" }] },
    { key: "newest", label: "Newest first", rules: [{ column: "raisedAt", dir: "desc" }] },
  ],
  groups: ["type", "severity", "state"],
  columns: [
    { key: "code", label: "Exception", kind: "code", cell: "ref", width: "132px", align: "start", priority: 1 },
    { key: "title", label: "What", kind: "text", cell: "text", strong: true, width: "minmax(200px,1.6fr)", align: "start", priority: 1 },
    { key: "type", label: "Type", kind: "text", cell: "muted", width: "150px", align: "start", priority: 2 },
    { key: "severity", label: "Severity", kind: "status", cell: "dot", tones: { High: "bad", Medium: "warn", Low: "neutral" }, width: "100px", align: "start", priority: 3 },
    { key: "state", label: "State", kind: "status", cell: "state", tones: { Open: "warn", Decided: "ok" }, width: "110px", align: "start", priority: 1 },
    { key: "decision", label: "Decision", kind: "text", cell: "text", width: "minmax(140px,1fr)", align: "start", priority: 2 },
    { key: "raisedBy", label: "Raised by", kind: "text", cell: "text", width: "130px", align: "start", priority: 3 },
    { key: "raised", label: "Raised", kind: "date", cell: "date", dayFormat: "relative", width: "110px", align: "end", priority: 2 },
    { key: "raisedAt", label: "Raised at", kind: "date", cell: "date", hidden: true, width: "150px", align: "end", priority: 3 },
    { key: "decide", label: "", kind: "text", cell: "action", action: "decide", width: "72px", align: "end", priority: 1 },
  ],
  rowHref: ["{targetHref}", "/milling/exceptions?sheet=mill-exception-decide&id={id}"],
  rowMenu: [
    { key: "decide", label: "Decide", requires: mill("exception.decide"), when: [{ column: "stateKey", op: "is", value: ["OPEN"] }], do: { sheet: "mill-exception-decide" } },
    { key: "open", label: "Open the record", requires: MILL_VIEW, do: { href: "{targetHref}" } },
  ],
  bulk: [{ key: "export" }],
  card: { title: "title", badge: "state", figure: "", meta: "{code} · {type}", metaMono: ["code"], meta2: "{raisedText}" },
  empty: {
    icon: "WarningCircle",
    title: "No exceptions yet",
    line: "A failed test, a breakdown, a count that is off or a load over the truck stops here until management decides.",
  },
};

export const EXCEPTIONS_LIST: ReportDefinition = {
  ...LIST_BASE,
  key: "milling-exception-list",
  title: "Exceptions",
  href: "/milling/exceptions",
  params: [],
  columns: exceptions.columns,
  defaults: { sort: [{ column: "raisedAt", dir: "asc" }] },
  list: exceptions,
};
