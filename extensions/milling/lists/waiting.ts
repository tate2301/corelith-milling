import type { ListSpec, ReportDefinition } from "@/lib/reports/types";

import { LIST_BASE, mill, MILL_VIEW } from "./shared";

/**
 * Waiting for you (HM-A1): every record this person's groups let them
 * decide, oldest first. Plans and shifts are decided from here, ticked
 * together; the rest open their record, where the decision has its own
 * checks. The Overview shows the first few and links here.
 */
const waiting: ListSpec = {
  noun: "records",
  read: MILL_VIEW,
  search: { placeholder: "Search what is waiting", keys: ["code", "what", "sentBy"] },
  tabs: [
    { key: "all", label: "All", where: [], empty: "Nothing is waiting for your decision." },
    { key: "here", label: "Decide here", where: [{ column: "kindKey", op: "is", value: ["plan", "shift"] }], empty: "No plan or shift is waiting for you." },
  ],
  filters: [{ key: "what", label: "What", type: "choice", any: "Anything", primary: true, optionsFromLoader: true, column: "what" }],
  sorts: [
    { key: "oldest", label: "Oldest first", rules: [{ column: "sentAt", dir: "asc" }] },
    { key: "newest", label: "Newest first", rules: [{ column: "sentAt", dir: "desc" }] },
  ],
  groups: ["what"],
  columns: [
    { key: "code", label: "Record", kind: "code", cell: "ref", width: "minmax(220px,1.2fr)", align: "start", priority: 1 },
    { key: "what", label: "What", kind: "text", cell: "text", strong: true, width: "minmax(200px,1.6fr)", align: "start", priority: 1 },
    { key: "sentBy", label: "Sent by", kind: "text", cell: "text", width: "minmax(130px,1fr)", align: "start", priority: 2 },
    { key: "sent", label: "Sent", kind: "date", cell: "date", dayFormat: "relative", width: "120px", align: "end", priority: 2 },
    { key: "sentAt", label: "Sent at", kind: "date", cell: "date", hidden: true, width: "150px", align: "end", priority: 3 },
    { key: "quantity", label: "Quantity", kind: "text", cell: "mono", width: "130px", align: "end", priority: 2 },
  ],
  rowHref: "{href}",
  rowMenu: [
    {
      key: "approve",
      label: "Approve",
      requires: mill("plan.approve", "shift.approve"),
      when: [{ column: "kindKey", op: "is", value: ["plan", "shift"] }],
      do: { confirm: { title: "Approve it?", body: "It goes through the same checks as on its own page.", confirm: "Approve" }, endpoint: "/api/milling/waiting/approve" },
    },
    { key: "send-back", label: "Send back", requires: mill("plan.approve"), when: [{ column: "kindKey", op: "is", value: ["plan"] }], do: { sheet: "mill-plan-send-back" } },
    { key: "open", label: "Open the record", separated: true, requires: MILL_VIEW, do: { href: "{href}" } },
  ],
  bulk: [
    {
      key: "approve",
      label: "Approve",
      requires: mill("plan.approve", "shift.approve"),
      when: [{ column: "kindKey", op: "is", value: ["plan", "shift"] }],
      do: { confirm: { title: "Approve these?", body: "Each goes through the same checks as on its own page; any that cannot be approved is left and said why.", confirm: "Approve" }, endpoint: "/api/milling/waiting/approve" },
    },
    { key: "send-back", label: "Send back", requires: mill("plan.approve"), when: [{ column: "kindKey", op: "is", value: ["plan"] }], do: { sheet: "mill-plan-send-back" } },
    { key: "export" },
  ],
  card: { title: "what", figure: "quantity", meta: "{code} · {sentBy}", metaMono: ["code"] },
  empty: { icon: "CheckCircle", title: "Nothing is waiting for you", line: "Plans, runs, tickets, shifts and exceptions your groups decide appear here as they are sent." },
};

export const WAITING_LIST: ReportDefinition = {
  ...LIST_BASE,
  key: "milling-waiting",
  title: "Waiting for you",
  href: "/milling/waiting",
  params: [],
  columns: waiting.columns,
  defaults: { sort: [{ column: "sentAt", dir: "asc" }] },
  list: waiting,
};
