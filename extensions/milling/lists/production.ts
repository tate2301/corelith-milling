import type { ListSpec, ReportDefinition } from "@/lib/reports/types";

import { LIST_BASE, mill, MILL_VIEW } from "./shared";

/**
 * Production › Runs (canvas PR-A1): each batch on the line, its shift, its
 * state, the maize in, what came out and the extraction, who started it and
 * when. The totals are the maize, the output and the extraction over them.
 */
const runs: ListSpec = {
  noun: "runs",
  read: MILL_VIEW,
  search: { placeholder: "Search runs", keys: ["code", "plan", "startedBy"] },
  tabs: [
    { key: "all", label: "All", where: [] },
    { key: "running", label: "Running", where: [{ column: "stateKey", op: "is", value: ["OPEN", "IN_PROGRESS"] }], empty: "Nothing is running." },
    { key: "hold", label: "On hold", where: [{ column: "stateKey", op: "is", value: ["AWAITING_DECISION"] }], empty: "No run is on hold." },
    { key: "completed", label: "Completed", where: [{ column: "stateKey", op: "is", value: ["COMPLETED"] }] },
  ],
  filters: [
    { key: "plan", type: "parent", column: "planId" },
    { key: "onShift", type: "parent", column: "shiftId" },
    { key: "date", label: "Date", type: "period", any: "Any time", column: "date", primary: true, default: "this-week" },
    { key: "shift", label: "Shift", type: "choice", any: "Any", primary: true, options: [{ value: "Day", label: "Day" }, { value: "Night", label: "Night" }], column: "shift" },
  ],
  sorts: [
    { key: "newest", label: "Newest first", rules: [{ column: "startedAt", dir: "desc" }] },
    { key: "extraction", label: "Lowest extraction", rules: [{ column: "extraction", dir: "asc" }] },
  ],
  groups: ["shift", "state", "startedBy"],
  columns: [
    { key: "code", label: "Run", kind: "code", cell: "ref", width: "140px", align: "start", priority: 1 },
    { key: "shift", label: "Shift", kind: "text", cell: "text", width: "80px", align: "start", priority: 2 },
    { key: "plan", label: "Plan", kind: "code", cell: "mono", width: "140px", align: "start", priority: 3 },
    { key: "state", label: "State", kind: "status", cell: "state", tones: { Started: "pending", Running: "info", "On hold": "warn", Completed: "ok" }, width: "120px", align: "start", priority: 1 },
    { key: "maizeKg", label: "Maize in kg", kind: "number", cell: "num", total: "sum", width: "120px", align: "end", priority: 1 },
    { key: "outputKg", label: "Out kg", kind: "number", cell: "num", total: "sum", width: "110px", align: "end", priority: 1 },
    { key: "extraction", label: "Extraction", kind: "number", cell: "num", percent: true, total: "avg", ratio: { num: "outputKg", den: "maizeKg" }, width: "110px", align: "end", priority: 2 },
    { key: "startedBy", label: "Started by", kind: "text", cell: "text", width: "minmax(140px,1fr)", align: "start", priority: 3 },
    { key: "startedAt", label: "Started at", kind: "date", cell: "date", hidden: true, width: "150px", align: "end", priority: 3 },
    { key: "started", label: "Started", kind: "text", cell: "mono", width: "110px", align: "end", priority: 2 },
  ],
  rowHref: "/milling/production/{id}",
  rowMenu: [{ key: "open", label: "Open", requires: MILL_VIEW, do: { href: "/milling/production/{id}" } }],
  bulk: [{ key: "export" }],
  primary: { label: "New run", icon: "plus", requires: mill("batch.run"), sheet: "mill-run-start" },
  card: { title: "code", badge: "state", figure: "maizeKg", meta: "{shift} · {started}", meta2: "{startedBy}" },
  empty: {
    icon: "Factory",
    title: "No runs yet",
    line: "A run takes maize from a lot through the line and records what came out, stage by stage.",
    primary: { label: "Start a run", sheet: "mill-run-start", requires: mill("batch.run") },
  },
};

/**
 * Production › Production runs (Grandmeal spec, Stage 1): each run's
 * product, bags, batch number and date produced, the maize against the
 * recipe, and, for accounting only, what a bag cost.
 */
const productionRuns: ListSpec = {
  noun: "production runs",
  read: MILL_VIEW,
  search: { placeholder: "Search runs", keys: ["code", "batch", "product", "recordedBy"] },
  tabs: [{ key: "all", label: "All", where: [] }],
  filters: [
    { key: "date", label: "Produced", type: "period", any: "Any time", column: "date", primary: true, default: "this-week" },
    { key: "product", label: "Product", type: "choice", any: "Any", primary: true, optionsFromLoader: true, column: "product" },
  ],
  sorts: [{ key: "newest", label: "Newest first", rules: [{ column: "recordedAt", dir: "desc" }] }],
  groups: ["product", "recordedBy"],
  columns: [
    { key: "batch", label: "Batch", kind: "code", cell: "ref", width: "150px", align: "start", priority: 1 },
    { key: "product", label: "Product", kind: "text", cell: "text", width: "minmax(160px,1.2fr)", align: "start", priority: 1 },
    { key: "bags", label: "Bags", kind: "number", cell: "num", total: "sum", width: "90px", align: "end", priority: 1 },
    { key: "produced", label: "Produced", kind: "date", cell: "date", dayFormat: "medium", width: "120px", align: "end", priority: 1 },
    { key: "recipeKg", label: "Recipe kg", kind: "number", cell: "num", total: "sum", width: "110px", align: "end", priority: 2 },
    { key: "actualKg", label: "Used kg", kind: "number", cell: "num", total: "sum", width: "110px", align: "end", priority: 2 },
    { key: "varianceKg", label: "Yield variance kg", kind: "number", cell: "num", total: "sum", width: "140px", align: "end", priority: 2 },
    { key: "bagCost", label: "Cost a bag", kind: "money", cell: "money", currency: "USD", width: "110px", align: "end", priority: 3 },
    { key: "code", label: "Run", kind: "code", cell: "mono", width: "140px", align: "start", priority: 3 },
    { key: "recordedBy", label: "Recorded by", kind: "text", cell: "muted", width: "140px", align: "start", priority: 3 },
    { key: "recordedAt", label: "Recorded", kind: "date", cell: "date", hidden: true, width: "150px", align: "end", priority: 3 },
  ],
  rowHref: "/milling/trace?code={batch}",
  bulk: [{ key: "export" }],
  primary: { label: "Record a run", icon: "plus", requires: mill("production.run"), sheet: "mill-production-run" },
  card: { title: "product", badge: "batch", figure: "bags", meta: "{produced} · {recordedBy}" },
  empty: {
    icon: "Factory",
    title: "No production runs yet",
    line: "A run records the bags made under one batch number and date. The recipe's maize and packaging come off stock, and the bags land in the store at once.",
    primary: { label: "Record a run", sheet: "mill-production-run", requires: mill("production.run") },
  },
};

/** Production › Packing (canvas PK-A1): bags packed from a bulk lot, the check weights and the bulk against the recipe. */
const packing: ListSpec = {
  noun: "packing runs",
  read: MILL_VIEW,
  search: { placeholder: "Search packing", keys: ["code", "product", "bulkLot", "packedBy"] },
  filters: [
    { key: "date", label: "Date", type: "period", any: "Any time", column: "date", primary: true, default: "this-week" },
    { key: "product", label: "Product", type: "choice", any: "Any", primary: true, optionsFromLoader: true, column: "product" },
  ],
  sorts: [{ key: "newest", label: "Newest first", rules: [{ column: "packedAt", dir: "desc" }] }],
  groups: ["product", "packedBy"],
  columns: [
    { key: "code", label: "Packing run", kind: "code", cell: "ref", width: "140px", align: "start", priority: 1 },
    { key: "product", label: "Product", kind: "text", cell: "text", width: "minmax(160px,1.2fr)", align: "start", priority: 1 },
    { key: "bulkLot", label: "From lot", kind: "code", cell: "mono", width: "150px", align: "start", priority: 2 },
    { key: "bags", label: "Bags", kind: "number", cell: "num", total: "sum", width: "90px", align: "end", priority: 1 },
    { key: "damaged", label: "Damaged", kind: "number", cell: "num", total: "sum", width: "90px", align: "end", priority: 2 },
    { key: "bulkKg", label: "Bulk used kg", kind: "number", cell: "num", total: "sum", width: "120px", align: "end", priority: 2 },
    { key: "varianceKg", label: "Against recipe kg", kind: "number", cell: "diff", diff: "variance", total: "sum", width: "140px", align: "end", priority: 1 },
    { key: "checks", label: "Check weights", kind: "status", cell: "state", toneKey: "checksTone", tones: { "In range": "ok", Light: "warn", "Not taken": "hollow" }, width: "130px", align: "start", priority: 2 },
    { key: "packedAt", label: "Packed at", kind: "date", cell: "date", hidden: true, width: "150px", align: "end", priority: 3 },
    { key: "packed", label: "Packed", kind: "text", cell: "mono", width: "110px", align: "end", priority: 2 },
  ],
  rowHref: "/milling/trace?code={bulkLot}",
  bulk: [{ key: "export" }],
  primary: { label: "New packing run", icon: "plus", requires: mill("stage.record"), sheet: "mill-pack" },
  card: { title: "code", badge: "checks", figure: "bags", meta: "{product} · {bulkLot}", meta2: "{packed}" },
  empty: {
    icon: "Package",
    title: "Nothing packed yet",
    line: "A packing run takes released meal from a bulk lot into bags, with check weights against the recipe.",
    primary: { label: "Pack", sheet: "mill-pack", requires: mill("stage.record") },
  },
};

/** Quality › Tests (canvas QT-A1): lots waiting for a decision, and what each test found. */
const tests: ListSpec = {
  noun: "lots",
  read: MILL_VIEW,
  search: { placeholder: "Search lots", keys: ["code", "product", "waiting"] },
  tabs: [
    { key: "hold", label: "On hold", where: [{ column: "stateKey", op: "is", value: ["HOLD"] }], empty: "Nothing is waiting for a test." },
    { key: "released", label: "Released", where: [{ column: "stateKey", op: "is", value: ["AVAILABLE", "RELEASED"] }] },
    { key: "rejected", label: "Rejected", where: [{ column: "stateKey", op: "is", value: ["REJECTED"] }] },
    { key: "all", label: "All", where: [] },
  ],
  filters: [
    { key: "date", label: "Made", type: "period", any: "Any time", column: "date", primary: true, default: "any" },
    { key: "origin", label: "From", type: "choice", any: "Any", primary: true, options: [{ value: "Run", label: "A run" }, { value: "Intake", label: "Intake" }, { value: "Return", label: "A return" }], column: "origin" },
  ],
  sorts: [{ key: "oldest", label: "Oldest first", rules: [{ column: "producedAt", dir: "asc" }] }],
  groups: ["product", "origin", "state"],
  columns: [
    { key: "code", label: "Lot", kind: "code", cell: "ref", width: "170px", align: "start", priority: 1 },
    { key: "product", label: "Product", kind: "text", cell: "text", width: "minmax(160px,1.2fr)", align: "start", priority: 1 },
    { key: "origin", label: "From", kind: "text", cell: "muted", width: "90px", align: "start", priority: 2 },
    { key: "quantity", label: "Holds kg", kind: "number", cell: "num", total: "sum", width: "110px", align: "end", priority: 1 },
    { key: "lastTest", label: "Last test", kind: "status", cell: "state", toneKey: "lastTestTone", tones: { Passed: "ok", Failed: "bad", Incomplete: "warn", "Not tested": "hollow" }, width: "120px", align: "start", priority: 1 },
    { key: "state", label: "State", kind: "status", cell: "state", tones: { "On hold": "warn", Released: "ok", Rejected: "bad", Used: "hollow" }, width: "110px", align: "start", priority: 1 },
    { key: "waiting", label: "Waiting on", kind: "code", cell: "mono", width: "140px", align: "start", priority: 3 },
    { key: "producedAt", label: "Made at", kind: "date", cell: "date", hidden: true, width: "150px", align: "end", priority: 3 },
    { key: "made", label: "Made", kind: "text", cell: "mono", width: "120px", align: "end", priority: 2 },
  ],
  rowHref: "/milling/quality/{id}",
  bulk: [{ key: "export" }],
  card: { title: "code", badge: "state", figure: "quantity", meta: "{product} · {origin}", meta2: "{lastTest} · {made}" },
  empty: { icon: "Flask", title: "No lots to test", line: "Meal from a run, and maize from intake, wait here on hold until quality tests and releases them." },
};

const def = (key: string, title: string, href: string, list: ListSpec, sort: string, dir: "asc" | "desc"): ReportDefinition => ({
  ...LIST_BASE,
  key,
  title,
  href,
  params: [],
  columns: list.columns,
  defaults: { sort: [{ column: sort, dir }] },
  list,
});

export const PRODUCTION_RUNS_LIST = def("milling-production-run-list", "Production runs", "/milling/production/runs", productionRuns, "recordedAt", "desc");
export const RUNS_LIST = def("milling-run-list", "Runs", "/milling/production", runs, "startedAt", "desc");
export const PACKING_LIST = def("milling-packing-list", "Packing", "/milling/packing", packing, "packedAt", "desc");
export const TESTS_LIST = def("milling-test-list", "Tests", "/milling/quality", tests, "producedAt", "asc");
