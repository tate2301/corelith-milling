import type { ListSpec, ReportDefinition } from "@/lib/reports/types";

import { LIST_BASE, mill } from "./shared";

/**
 * Settings › Cost treatments (Grandmeal spec, Workspace setup): every raw
 * material, packaging item and consumable, and where its cost lands in profit
 * and loss. Only accounting reads and sets them; a production run will not use
 * an item without one.
 */
const costs: ListSpec = {
  noun: "items",
  read: mill("money.view"),
  search: { placeholder: "Search items", keys: ["item", "code", "category"] },
  tabs: [
    { key: "missing", label: "Not set", where: [{ column: "set", op: "is", value: ["No"] }], empty: "Every item has a cost treatment." },
    { key: "all", label: "All", where: [] },
  ],
  filters: [{ key: "treatment", label: "Treatment", type: "choice", any: "Any", primary: true, options: [{ value: "Cost of sales", label: "Cost of sales" }, { value: "Operating expense", label: "Operating expense" }, { value: "Asset", label: "Asset" }, { value: "Not set", label: "Not set" }], column: "treatment" }],
  sorts: [{ key: "name", label: "Name A–Z", rules: [{ column: "item", dir: "asc" }] }],
  groups: ["treatment", "category"],
  columns: [
    { key: "item", label: "Item", kind: "text", cell: "text", width: "minmax(200px,1.4fr)", align: "start", priority: 1 },
    { key: "code", label: "Code", kind: "code", cell: "mono", width: "130px", align: "start", priority: 2 },
    { key: "category", label: "Category", kind: "text", cell: "muted", width: "160px", align: "start", priority: 3 },
    { key: "treatment", label: "Treatment", kind: "status", cell: "state", tones: { "Cost of sales": "info", "Operating expense": "warn", Asset: "ok", "Not set": "bad" }, width: "170px", align: "start", priority: 1 },
    { key: "setBy", label: "Set by", kind: "text", cell: "muted", width: "140px", align: "start", priority: 3 },
  ],
  rowHref: "/milling/settings/costs?sheet=mill-cost-treatment&id={id}",
  rowMenu: [{ key: "set", label: "Set treatment", requires: mill("cost.set"), do: { sheet: "mill-cost-treatment" } }],
  bulk: [{ key: "set", label: "Set treatment", requires: mill("cost.set"), do: { sheet: "mill-cost-treatment" } }, { key: "export" }],
  card: { title: "item", badge: "treatment", figure: "code", meta: "{code} · {category}", metaMono: ["code"] },
  empty: { icon: "Calculator", title: "No items yet", line: "Raw materials, packaging and consumables appear here once they are in Stores." },
};

export const COSTS_LIST: ReportDefinition = { ...LIST_BASE, key: "milling-cost-treatment-list", title: "Cost treatments", href: "/milling/settings/costs", params: [], columns: costs.columns, defaults: { sort: [{ column: "item", dir: "asc" }] }, list: costs };
