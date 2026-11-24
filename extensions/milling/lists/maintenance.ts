import type { ListSpec, ReportDefinition } from "@/lib/reports/types";

import { LIST_BASE, mill, MILL_VIEW } from "./shared";

/**
 * Maintenance › Machine release: every machine at the mill and whether it
 * may run. A breakdown takes a machine out of use; the workshop marks it in
 * repair and repaired, and a supervisor releases it for work.
 */
const machines: ListSpec = {
  noun: "machines",
  read: MILL_VIEW,
  search: { placeholder: "Search machines", keys: ["code", "name", "category", "stop"] },
  tabs: [
    { key: "all", label: "All", where: [] },
    { key: "out", label: "Out of use", where: [{ column: "stateKey", op: "isNot", value: ["AVAILABLE"] }], empty: "Every machine is released for work." },
    { key: "release", label: "To release", where: [{ column: "stateKey", op: "is", value: ["AWAITING_RELEASE"] }], empty: "No machine is waiting to be released." },
  ],
  filters: [{ key: "category", label: "Kind", type: "choice", any: "Any", primary: true, optionsFromLoader: true, column: "category" }],
  sorts: [{ key: "code", label: "Code", rules: [{ column: "code", dir: "asc" }] }],
  groups: ["category", "state"],
  columns: [
    { key: "code", label: "Code", kind: "code", cell: "mono", width: "120px", align: "start", priority: 1 },
    { key: "name", label: "Machine", kind: "text", cell: "text", strong: true, width: "minmax(180px,1.4fr)", align: "start", priority: 1 },
    { key: "category", label: "Kind", kind: "text", cell: "muted", width: "140px", align: "start", priority: 2 },
    { key: "state", label: "State", kind: "status", cell: "state", tones: { Available: "ok", Down: "bad", "In repair": "warn", "To release": "info" }, width: "120px", align: "start", priority: 1 },
    { key: "stop", label: "Stopped for", kind: "text", cell: "text", width: "minmax(180px,1.4fr)", align: "start", priority: 2 },
    { key: "since", label: "Since", kind: "text", cell: "mono", width: "120px", align: "end", priority: 2 },
  ],
  rowHref: "/milling/downtime",
  rowMenu: [
    { key: "in-repair", label: "In repair", requires: mill("fault.report"), when: [{ column: "stateKey", op: "is", value: ["DOWN"] }], do: { confirm: { title: "The workshop has it?", body: "It shows as in repair until it is mended.", confirm: "In repair" }, endpoint: "/api/milling/equipment/many/in-repair" } },
    { key: "repaired", label: "Repaired", requires: mill("fault.report"), when: [{ column: "stateKey", op: "is", value: ["DOWN", "IN_REPAIR"] }], do: { confirm: { title: "Repaired?", body: "A supervisor is asked to check it and release it for work.", confirm: "Repaired" }, endpoint: "/api/milling/equipment/many/repaired" } },
    { key: "release", label: "Release for work", requires: mill("machine.release"), when: [{ column: "stateKey", op: "is", value: ["AWAITING_RELEASE"] }], do: { confirm: { title: "Release it for work?", body: "It can be chosen on a run again, and its stop ends now.", confirm: "Release" }, endpoint: "/api/milling/equipment/many/release" } },
  ],
  bulk: [
    { key: "release", label: "Release for work", requires: mill("machine.release"), when: [{ column: "stateKey", op: "is", value: ["AWAITING_RELEASE"] }], do: { confirm: { title: "Release these for work?", body: "Each can be chosen on a run again, and its stop ends now.", confirm: "Release" }, endpoint: "/api/milling/equipment/many/release" } },
    { key: "export" },
  ],
  primary: { label: "Log downtime", icon: "plus", requires: mill("fault.report"), sheet: "mill-stop-new" },
  card: { title: "name", badge: "state", figure: "", meta: "{code} · {category}", metaMono: ["code"], meta2: "{stop}" },
  empty: { icon: "Wrench", title: "No machines at the mill", line: "Machines are added under Maintenance, Equipment." },
};

export const MACHINES_LIST: ReportDefinition = {
  ...LIST_BASE,
  key: "milling-machine-list",
  title: "Machine release",
  href: "/milling/maintenance",
  params: [],
  columns: machines.columns,
  defaults: { sort: [{ column: "code", dir: "asc" }] },
  list: machines,
};
