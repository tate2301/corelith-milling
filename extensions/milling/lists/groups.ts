import { MILL_GROUPS } from "@/lib/milling/access/groups";
import type { ListSpec, ReportDefinition } from "@/lib/reports/types";

import { LIST_BASE, mill } from "./shared";

/**
 * Settings › Who does what: everyone who can sign in and the mill groups
 * they hold. One person may hold several; a row opens its sheet, where the
 * groups are ticked. Owners and managers may do everything without a group.
 */
const groups: ListSpec = {
  noun: "people",
  sub: "One person may hold several groups. Owners and managers may do everything at the mill without one.",
  read: mill("settings.manage"),
  search: { placeholder: "Search people", keys: ["name", "email", "groups"] },
  tabs: [
    { key: "all", label: "Everyone", where: [] },
    { key: "none", label: "In no group", where: [{ column: "count", op: "is", value: ["0"] }], empty: "Everyone is in at least one group." },
  ],
  filters: [
    {
      key: "group",
      label: "Group",
      type: "choice",
      any: "Any",
      primary: true,
      options: MILL_GROUPS.map((group) => ({ value: group.code.toLowerCase(), label: group.name, where: [{ column: "groups", op: "contains" as const, value: group.name }] })),
    },
  ],
  sorts: [{ key: "name", label: "Name A–Z", rules: [{ column: "name", dir: "asc" }] }],
  columns: [
    { key: "name", label: "Person", kind: "text", cell: "link", width: "minmax(180px,1.2fr)", align: "start", priority: 1 },
    { key: "email", label: "Email", kind: "text", cell: "muted", width: "minmax(180px,1.2fr)", align: "start", priority: 3 },
    { key: "groups", label: "Groups", kind: "text", cell: "text", width: "minmax(240px,2fr)", align: "start", priority: 1 },
    { key: "count", label: "Groups held", kind: "number", cell: "num", width: "120px", align: "end", priority: 2 },
    { key: "access", label: "Access", kind: "status", cell: "dot", tones: { Active: "ok", Removed: "hollow", Everything: "info" }, width: "120px", align: "start", priority: 2 },
  ],
  rowHref: "/milling/settings/groups?sheet=mill-person-groups&id={id}",
  rowMenu: [{ key: "edit", label: "Change groups", requires: mill("settings.manage"), do: { sheet: "mill-person-groups" } }],
  bulk: [{ key: "export" }],
  card: { title: "name", badge: "access", figure: "", meta: "{groups}" },
  empty: { icon: "Users", title: "No one to place yet", line: "Add people under People first; they appear here to be given groups." },
};

export const GROUPS_LIST: ReportDefinition = {
  ...LIST_BASE,
  key: "milling-setting-groups",
  title: "Who does what",
  href: "/milling/settings/groups",
  params: [],
  columns: groups.columns,
  defaults: { sort: [{ column: "name", dir: "asc" }] },
  list: groups,
};
