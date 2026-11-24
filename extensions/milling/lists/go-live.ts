import type { ListSpec, ReportDefinition } from "@/lib/reports/types";

import { LIST_BASE, mill, MILL_VIEW } from "./shared";

/**
 * Go-live (GL-A1): the seven steps before the mill's first day, each state
 * read from what is there (sites, people in groups, priced and weighed
 * products, the till's fiscal device, opening stock, Books' balances,
 * recipes and specs), never from a link having been visited.
 */
const steps: ListSpec = {
  noun: "steps",
  read: MILL_VIEW,
  search: { placeholder: "Search steps", keys: ["step", "owner", "detail"] },
  tabs: [
    { key: "all", label: "All", where: [] },
    { key: "waiting", label: "Waiting", where: [{ column: "stateKey", op: "is", value: ["WAITING"] }], empty: "No step is waiting on anyone." },
    { key: "todo", label: "Not done", where: [{ column: "stateKey", op: "isNot", value: ["DONE"] }], empty: "Every step is done. The mill is ready for its first day." },
    { key: "done", label: "Done", where: [{ column: "stateKey", op: "is", value: ["DONE"] }], empty: "No step is done yet." },
  ],
  filters: [],
  sorts: [{ key: "order", label: "In order", rules: [{ column: "order", dir: "asc" }] }],
  columns: [
    { key: "step", label: "Step", kind: "text", cell: "link", width: "minmax(200px,1.4fr)", align: "start", priority: 1 },
    { key: "layer", label: "Layer", kind: "code", cell: "mono", width: "90px", align: "start", priority: 3 },
    { key: "owner", label: "Owner", kind: "text", cell: "text", width: "minmax(140px,1fr)", align: "start", priority: 2 },
    { key: "state", label: "State", kind: "status", cell: "state", tones: { Done: "ok", Started: "info", Waiting: "warn", "Not started": "hollow" }, width: "130px", align: "start", priority: 1 },
    { key: "detail", label: "Detail", kind: "text", cell: "muted", width: "minmax(220px,2fr)", align: "start", priority: 2 },
    { key: "order", label: "Order", kind: "number", cell: "num", hidden: true, width: "80px", align: "end", priority: 3 },
  ],
  rowHref: "{href}",
  bulk: [{ key: "export" }],
  card: { title: "step", badge: "state", figure: "", meta: "{owner}", meta2: "{detail}" },
  empty: { icon: "RocketLaunch", title: "No go-live steps", line: "The steps are read from the mill's setup." },
};

/** Go-live › Opening stock: each item counted at its place and its cost, on the draft opening stock. */
const openingLines: ListSpec = {
  noun: "counts",
  read: MILL_VIEW,
  search: { placeholder: "Search counts", keys: ["product", "place"] },
  filters: [{ key: "opening", type: "parent", column: "openingId" }],
  sorts: [{ key: "product", label: "Item A–Z", rules: [{ column: "product", dir: "asc" }] }],
  groups: ["place"],
  columns: [
    { key: "product", label: "Item", kind: "text", cell: "text", strong: true, width: "minmax(200px,1.5fr)", align: "start", priority: 1 },
    { key: "place", label: "Where", kind: "text", cell: "text", width: "minmax(140px,1fr)", align: "start", priority: 2 },
    { key: "counted", label: "Counted", kind: "text", cell: "mono", width: "140px", align: "end", priority: 1 },
    { key: "unitCost", label: "Cost each", kind: "money", cell: "money", currency: "USD", width: "120px", align: "end", priority: 2 },
    { key: "value", label: "Value", kind: "money", cell: "money", currency: "USD", total: "sum", width: "130px", align: "end", priority: 1 },
  ],
  rowHref: "/milling/go-live/opening-stock",
  rowMenu: [
    {
      key: "remove",
      label: "Take off",
      tone: "bad",
      requires: mill("stock.count"),
      when: [{ column: "postedKey", op: "is", value: ["no"] }],
      do: { confirm: { title: "Take this count off?", body: "It comes off the opening stock. Count it again if it was wrong.", confirm: "Take off", tone: "bad" }, endpoint: "/api/milling/go-live/opening/lines/remove" },
    },
  ],
  bulk: [
    {
      key: "remove",
      label: "Take off",
      tone: "bad",
      requires: mill("stock.count"),
      when: [{ column: "postedKey", op: "is", value: ["no"] }],
      do: { confirm: { title: "Take these counts off?", body: "They come off the opening stock. Count them again if they were wrong.", confirm: "Take off", tone: "bad" }, endpoint: "/api/milling/go-live/opening/lines/remove" },
    },
    { key: "export" },
  ],
  card: { title: "product", figure: "value", meta: "{place} · {counted}" },
  empty: { icon: "Package", title: "Nothing counted yet", line: "Count each item where it stands, at its cost." },
};

export const GO_LIVE_LIST: ReportDefinition = { ...LIST_BASE, key: "milling-go-live", title: "Go-live", href: "/milling/go-live", params: [], columns: steps.columns, defaults: { sort: [{ column: "order", dir: "asc" }] }, list: steps };
export const OPENING_LINES_LIST: ReportDefinition = {
  ...LIST_BASE,
  key: "milling-opening-lines",
  title: "Opening stock",
  href: "/milling/go-live/opening-stock",
  params: [],
  columns: openingLines.columns,
  defaults: { sort: [{ column: "product", dir: "asc" }] },
  list: openingLines,
};
