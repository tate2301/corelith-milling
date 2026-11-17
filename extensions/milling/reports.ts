import { periodParams } from "@/lib/reports/params";
import type { ReportDefinition } from "@/lib/reports/types";

/**
 * The mill's reports, in core's report catalogue (Reports, exports and
 * scheduled email come with it). Each is about one of the mill's pages and
 * gated on the mill's feature; loaders are in `./loaders.ts`.
 *
 * The client's list (plan v2, section 4) maps here:
 *   maize to production, meal and by-products   milling-production, milling-yields
 *   QC                                          milling-qc
 *   downtime hours                              milling-downtime
 *   fuel and generator                          milling-generator
 *   despatches and balances                     milling-despatches
 *   daily sales in tonnes and value             milling-despatch-daily
 *   stock: maize, packaging, thread             milling-stock, milling-stock-reconciliation
 *   delivery routes and refuelling per vehicle  milling-trips
 *   attendance, overtime, off days              milling-attendance
 *   one page for management every morning       milling-daily-operations
 */

const FEATURE = "milling.home";
const PROFILES = ["GENERAL"];
const AREA = "The mill";

const base = { featureKey: FEATURE, profiles: PROFILES, area: AREA } as const;

export const MILLING_REPORTS: ReportDefinition[] = [
  {
    ...base,
    key: "milling-daily-operations",
    title: "Daily operations",
    summary: "One day at the mill: intake, production, packing, stock, machines, despatch and exceptions.",
    href: "/milling",
    params: [{ key: "day", label: "Day", type: "date", default: "-1d" }],
    columns: [
      { key: "section", label: "Section", kind: "text" },
      { key: "measure", label: "Measure", kind: "text" },
      { key: "value", label: "Value", kind: "number" },
      { key: "unit", label: "Unit", kind: "text" },
    ],
    defaults: { groupBy: "section" },
    // A page to read, not a chart: each row is a different measure.
    layout: { blocks: [{ id: "lead", type: "text", text: "The mill's day, section by section. Stock is as it stands now." }, { id: "table", type: "table" }] },
  },
  {
    ...base,
    key: "milling-intake",
    title: "Maize intake",
    summary: "Deliveries by supplier: weight, how it was weighed, moisture and the QC decision.",
    href: "/milling/intake",
    params: periodParams(30),
    columns: [
      { key: "date", label: "Received", kind: "date" },
      { key: "code", label: "Delivery", kind: "code" },
      { key: "supplier", label: "Supplier", kind: "text" },
      { key: "method", label: "Weighed by", kind: "text" },
      { key: "weightStatus", label: "Weight", kind: "status" },
      { key: "netKg", label: "Net kg", kind: "number", total: "sum" },
      { key: "moisture", label: "Moisture %", kind: "number", total: "avg" },
      { key: "outcome", label: "QC", kind: "status" },
      { key: "status", label: "Status", kind: "status" },
    ],
    defaults: { sort: [{ column: "date", dir: "desc" }] },
  },
  {
    ...base,
    key: "milling-production",
    title: "Production by batch",
    summary: "Maize into each batch, product out, separated material, the unaccounted balance and the maize's value.",
    href: "/milling/production",
    params: periodParams(30),
    columns: [
      { key: "date", label: "Started", kind: "date" },
      { key: "code", label: "Batch", kind: "code" },
      { key: "maizeKg", label: "Maize in kg", kind: "number", total: "sum" },
      { key: "waterKg", label: "Water kg", kind: "number", total: "sum", hidden: true },
      { key: "outputKg", label: "Product kg", kind: "number", total: "sum" },
      { key: "separatedKg", label: "Separated kg", kind: "number", total: "sum" },
      { key: "unaccountedKg", label: "Unaccounted kg", kind: "number", total: "sum" },
      { key: "variancePct", label: "Unaccounted %", kind: "number", total: "avg" },
      { key: "maizeCost", label: "Maize value", kind: "money", total: "sum" },
      { key: "status", label: "Status", kind: "status" },
    ],
    defaults: { sort: [{ column: "date", dir: "desc" }] },
  },
  {
    ...base,
    key: "milling-yields",
    title: "Yields by product",
    summary: "Each batch's output by product, and its share of the maize: meal, bran, gem and powder.",
    href: "/milling/production",
    params: periodParams(30),
    columns: [
      { key: "date", label: "Batch started", kind: "date" },
      { key: "batch", label: "Batch", kind: "code" },
      { key: "product", label: "Product", kind: "text" },
      { key: "kg", label: "Kg", kind: "number", total: "sum" },
      { key: "yieldPct", label: "Of the maize %", kind: "number", total: "avg" },
      { key: "lot", label: "Lot", kind: "code" },
      { key: "qc", label: "QC", kind: "status" },
    ],
    defaults: { groupBy: "product" },
  },
  {
    ...base,
    key: "milling-qc",
    title: "Quality results",
    summary: "Every check made at intake and on product, with method, reading and result. Not performed is never a pass.",
    href: "/milling/quality",
    params: periodParams(30),
    columns: [
      { key: "date", label: "Inspected", kind: "date" },
      { key: "point", label: "Where", kind: "text" },
      { key: "target", label: "Delivery or lot", kind: "code" },
      { key: "check", label: "Check", kind: "text" },
      { key: "method", label: "Method", kind: "text" },
      { key: "value", label: "Reading", kind: "number" },
      { key: "result", label: "Result", kind: "status" },
    ],
    defaults: { sort: [{ column: "date", dir: "desc" }] },
  },
  {
    ...base,
    key: "milling-packing",
    title: "Packing",
    summary: "Bags packed by product, damaged bags, and bulk used beyond the bags' weight.",
    href: "/milling/packing",
    params: periodParams(30),
    columns: [
      { key: "date", label: "Packed", kind: "date" },
      { key: "code", label: "Run", kind: "code" },
      { key: "product", label: "Product", kind: "text" },
      { key: "bags", label: "Bags", kind: "number", total: "sum" },
      { key: "damaged", label: "Damaged", kind: "number", total: "sum" },
      { key: "bulkKg", label: "Bulk used kg", kind: "number", total: "sum" },
      { key: "giveawayKg", label: "Giveaway kg", kind: "number", total: "sum" },
    ],
    defaults: { groupBy: "product" },
  },
  {
    ...base,
    key: "milling-downtime",
    title: "Downtime",
    summary: "Stops by machine and cause, with hours lost.",
    href: "/milling/maintenance",
    params: periodParams(30),
    columns: [
      { key: "date", label: "Started", kind: "date" },
      { key: "machine", label: "Machine", kind: "text" },
      { key: "category", label: "What", kind: "status" },
      { key: "cause", label: "Cause", kind: "text" },
      { key: "hours", label: "Hours", kind: "number", total: "sum" },
      { key: "open", label: "Still stopped", kind: "status" },
    ],
    defaults: { groupBy: "machine" },
  },
  {
    ...base,
    key: "milling-generator",
    title: "Generator and fuel",
    summary: "Generator runs with hours and diesel, and fuel used on delivery trips.",
    href: "/milling/maintenance",
    params: periodParams(30),
    columns: [
      { key: "date", label: "Date", kind: "date" },
      { key: "use", label: "Used by", kind: "text" },
      { key: "hours", label: "Hours", kind: "number", total: "sum" },
      { key: "km", label: "Km", kind: "number", total: "sum" },
      { key: "litres", label: "Litres", kind: "number", total: "sum" },
      { key: "reason", label: "Why", kind: "text" },
    ],
    defaults: { groupBy: "use" },
  },
  {
    ...base,
    key: "milling-stock",
    title: "Stock on hand",
    summary: "Maize, bulk product, packed bags, empty bags and thread, by lot and place, now.",
    href: "/milling/stock",
    params: [],
    columns: [
      { key: "category", label: "Kind", kind: "text" },
      { key: "product", label: "Product", kind: "text" },
      { key: "lot", label: "Lot", kind: "code" },
      { key: "location", label: "Where", kind: "text" },
      { key: "status", label: "Status", kind: "status" },
      { key: "quantity", label: "Quantity", kind: "number", total: "sum" },
      { key: "unit", label: "Unit", kind: "text" },
      { key: "kg", label: "Kg", kind: "number", total: "sum" },
    ],
    defaults: { groupBy: "category" },
  },
  {
    ...base,
    key: "milling-stock-reconciliation",
    title: "Stock reconciliation",
    summary: "For each product: opening, in, out and closing over the period, by the mill's lot ledger.",
    href: "/milling/stock",
    params: periodParams(30),
    columns: [
      { key: "category", label: "Kind", kind: "text" },
      { key: "product", label: "Product", kind: "text" },
      { key: "opening", label: "Opening", kind: "number" },
      { key: "received", label: "In", kind: "number" },
      { key: "issued", label: "Out", kind: "number" },
      { key: "adjusted", label: "Counts and corrections", kind: "number" },
      { key: "closing", label: "Closing", kind: "number" },
      { key: "unit", label: "Unit", kind: "text" },
    ],
    defaults: {},
    // Units differ from row to row, so a chart across them would mislead.
    layout: { blocks: [{ id: "table", type: "table" }] },
  },
  {
    ...base,
    key: "milling-despatches",
    title: "Despatches",
    summary: "Every delivery line: customer, destination, bags and tonnes, and what was delivered, short or returned.",
    href: "/milling/deliveries",
    params: periodParams(30),
    columns: [
      { key: "date", label: "Left", kind: "date" },
      { key: "delivery", label: "Delivery", kind: "code" },
      { key: "customer", label: "Customer", kind: "text" },
      { key: "destination", label: "Destination", kind: "text" },
      { key: "product", label: "Product", kind: "text" },
      { key: "bags", label: "Bags", kind: "number", total: "sum" },
      { key: "tonnes", label: "Tonnes", kind: "number", total: "sum" },
      { key: "delivered", label: "Delivered", kind: "number", total: "sum" },
      { key: "short", label: "Short", kind: "number", total: "sum" },
      { key: "returned", label: "Returned", kind: "number", total: "sum" },
      { key: "value", label: "Value", kind: "money", total: "sum" },
      { key: "status", label: "Status", kind: "status" },
    ],
    defaults: { sort: [{ column: "date", dir: "desc" }] },
  },
  {
    ...base,
    key: "milling-despatch-daily",
    title: "Daily despatch in tonnes and value",
    summary: "Each day's despatches by product, in bags, tonnes and value at the order price.",
    href: "/milling/deliveries",
    params: periodParams(30),
    columns: [
      { key: "date", label: "Day", kind: "date" },
      { key: "product", label: "Product", kind: "text" },
      { key: "bags", label: "Bags", kind: "number", total: "sum" },
      { key: "tonnes", label: "Tonnes", kind: "number", total: "sum" },
      { key: "value", label: "Value", kind: "money", total: "sum" },
    ],
    defaults: { sort: [{ column: "date", dir: "desc" }] },
  },
  {
    ...base,
    key: "milling-trips",
    title: "Trips by vehicle",
    summary: "Each truck's trips: destination, distance, fuel and load.",
    href: "/milling/deliveries",
    params: periodParams(30),
    columns: [
      { key: "date", label: "Left", kind: "date" },
      { key: "vehicle", label: "Truck", kind: "text" },
      { key: "driver", label: "Driver", kind: "text" },
      { key: "destination", label: "Destination", kind: "text" },
      { key: "delivery", label: "Delivery", kind: "code" },
      { key: "loadKg", label: "Load kg", kind: "number", total: "sum" },
      { key: "km", label: "Km", kind: "number", total: "sum" },
      { key: "litres", label: "Fuel L", kind: "number", total: "sum" },
      { key: "status", label: "Status", kind: "status" },
    ],
    defaults: { groupBy: "vehicle" },
  },
  {
    ...base,
    key: "milling-attendance",
    title: "Shift attendance and overtime",
    summary: "Who worked each shift, on which duty, absences with their reasons, and overtime.",
    href: "/milling/shifts",
    params: periodParams(30),
    columns: [
      { key: "date", label: "Shift started", kind: "date" },
      { key: "shift", label: "Shift", kind: "code" },
      { key: "employee", label: "Person", kind: "text" },
      { key: "duty", label: "Duty", kind: "text" },
      { key: "attendance", label: "Attendance", kind: "status" },
      { key: "overtime", label: "Overtime h", kind: "number", total: "sum" },
      { key: "reason", label: "Reason", kind: "text" },
    ],
    defaults: { groupBy: "employee" },
  },
];
