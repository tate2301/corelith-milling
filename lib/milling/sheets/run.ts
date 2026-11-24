import { z } from "zod";

import type { MillLookups } from "@/components/milling/mill-ui";
import { fetchJson } from "@/lib/api-client";
import type { SheetKind } from "@/lib/workspace/sheet-kind";

import { idOf, labels, numberOf, text, type Choice } from "./choices";

type RouteStage = { id: string; code: string; name: string; required: boolean; capturesQuantities: boolean; equipment: Array<{ code: string; availability: string }> };
type RunDetail = { batch: { id: string; code: string; shiftId: string | null; inProcessChangeKg: number | null }; route: RouteStage[] };
type StockProduct = { code: string | null; name: string; lots: Array<{ id: string; code: string; status: string; balances: Array<{ stockLocationId: string; location: string; quantity: number; reserved: number }> }> };

const kg = (value: number) => `${value.toLocaleString("en-GB", { maximumFractionDigits: 1 })} kg`;
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/, "A number.");
const invalidate = [["list"], ["reports"], ["milling"], ["milling-run"]];
const detail = (id: string | null) => fetchJson<RunDetail>(`/api/milling/batches/${id}`);

/** The mill's clock, a wall-clock "YYYY-MM-DDTHH:mm": Zimbabwe is UTC+2 all year. */
function nowLocal() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
}
const iso = (value: unknown) => (typeof value === "string" && value ? new Date(`${value}:00+02:00`).toISOString() : null);

/** Issue maize to the run (RN-B1): from a released lot; the plan's reservation on it is used first. */
const issue: SheetKind = {
  title: (_ctx, values) => `Issue maize to ${String(values._code ?? "the run")}`,
  sub: "Only released lots are offered. The plan's reservation on a lot is used first.",
  cur: "US$",
  load: async (ctx) => {
    const [run, stock] = await Promise.all([detail(ctx.id), fetchJson<{ products: StockProduct[] }>("/api/milling/stock")]);
    const _lot: Choice[] = stock.products
      .filter((product) => product.code === "MAIZE")
      .flatMap((product) => product.lots.filter((lot) => lot.status === "AVAILABLE").flatMap((lot) => lot.balances.map((balance) => ({ id: `${lot.id}|${balance.stockLocationId}`, label: `${lot.code} at ${balance.location}, ${kg(balance.quantity)}${balance.reserved ? ` (${kg(balance.reserved)} reserved)` : ""}` }))));
    return { _code: run.batch.code, _lot, lot: _lot[0]?.label ?? "" };
  },
  sections: [
    {
      fields: [
        { id: "lot", t: "text", l: "Lot and place", o: (values) => labels(values, "lot"), needed: "Choose the lot." },
        { id: "kg", t: "text", l: "Kilograms", mono: true, right: true, inputMode: "decimal", needed: "Enter the kilograms issued.", schema: decimal },
      ],
    },
  ],
  note: "",
  primary: "Issue",
  done: "Maize issued",
  submit: (values, ctx) => {
    const [lotId, stockLocationId] = String(idOf(values, "lot") ?? "|").split("|");
    return { method: "POST", url: `/api/milling/batches/${ctx.id}/issue`, body: { lotId, stockLocationId, quantityKg: text(values.kg) } };
  },
  invalidate,
  requires: [["ext:milling", "batch.run"]],
};

/** Product out (RN-D1): a bulk product into its bin, as the run's lot for it, on hold until QC releases it. */
const output: SheetKind = {
  title: "Product out",
  sub: "Bulk product goes into the run's lot for it, on hold until quality releases it.",
  cur: "US$",
  load: async () => {
    const lookups = await fetchJson<MillLookups>("/api/milling/lookups");
    const _product: Choice[] = lookups.products.filter((product) => product.category === "Bulk product").map((product) => ({ id: product.id, label: product.name }));
    const _into: Choice[] = lookups.locations.map((location) => ({ id: location.id, label: `${location.code} · ${location.name}` }));
    return { _product, _into, product: _product[0]?.label ?? "", into: _into[0]?.label ?? "", weighed: "Weighed" };
  },
  sections: [
    {
      fields: [
        { id: "product", t: "text", l: "Product", half: true, o: (values) => labels(values, "product") },
        { id: "into", t: "text", l: "Into", half: true, o: (values) => labels(values, "into") },
        { id: "kg", t: "text", l: "Kilograms", half: true, mono: true, right: true, inputMode: "decimal", needed: "Enter the kilograms.", schema: decimal },
        { id: "weighed", t: "seg", l: "The figure is", half: true, o: ["Weighed", "Estimated"] },
      ],
    },
  ],
  note: "",
  primary: "Save",
  again: { keep: ["into", "weighed"] },
  done: (_result, values) => `${String(values.product ?? "Output")} recorded`,
  submit: (values, ctx) => ({ method: "POST", url: `/api/milling/batches/${ctx.id}/output`, body: { productId: idOf(values, "product"), stockLocationId: idOf(values, "into"), quantityKg: text(values.kg), isEstimated: values.weighed === "Estimated" } }),
  invalidate,
  requires: [["ext:milling", "stage.record"]],
};

/** Record a stage (RN-C1, RN-D1): when it ran, what went in and came out, measured or estimated, and anything abnormal. */
const stage: SheetKind = {
  title: (_ctx, values) => String(values._stage ?? "Record the stage"),
  sub: (_ctx, values) => String(values._sub ?? "Mark each quantity estimated unless it was weighed."),
  wide: true,
  cur: "US$",
  load: async (ctx) => {
    const run = await detail(ctx.id);
    const row = run.route.find((entry) => entry.id === ctx.params.get("stageId")) ?? run.route[0];
    const down = row?.equipment.filter((machine) => machine.availability !== "AVAILABLE").map((machine) => machine.code) ?? [];
    return {
      _stage: row ? `${row.name} on ${run.batch.code}` : "Record the stage",
      _sub: `${row?.equipment.map((machine) => machine.code).join(", ") || "No machines set"}. Mark each quantity estimated unless it was weighed.${down.length ? ` ${down.join(", ")} not released for work.` : ""}`,
      _stageId: row?.id ?? "",
      _shiftId: run.batch.shiftId,
      _quantities: row?.capturesQuantities ?? false,
      _conditioning: row?.code === "CONDITION",
      startedAt: nowLocal(),
      endedAt: "",
      inputHow: "Estimated",
      removedHow: "Estimated",
      abnormal: false,
    };
  },
  sections: [
    {
      fields: [
        { id: "startedAt", t: "datetime", l: "Started", half: true, latest: "today" },
        { id: "endedAt", t: "datetime", l: "Ended", half: true, opt: true, latest: "today", clearable: true },
      ],
    },
    {
      title: "Quantities",
      show: (values) => values._quantities === true,
      fields: [
        { id: "inputKg", t: "text", l: "In, kg", half: true, mono: true, right: true, inputMode: "decimal", opt: true, schema: decimal },
        { id: "inputHow", t: "seg", l: "The figure is", half: true, o: ["Weighed", "Estimated"] },
        { id: "removedKg", t: "text", l: "Removed, kg", h: "Dust, husks, stones, fines", half: true, mono: true, right: true, inputMode: "decimal", opt: true, schema: decimal },
        { id: "removedHow", t: "seg", l: "The figure is", half: true, o: ["Weighed", "Estimated"] },
      ],
    },
    {
      title: "Conditioning",
      show: (values) => values._conditioning === true,
      fields: [
        { id: "waterLitres", t: "text", l: "Water, litres", half: true, mono: true, right: true, inputMode: "decimal", opt: true, schema: decimal },
        { id: "moistureBeforePct", t: "text", l: "Moisture before, %", half: true, mono: true, right: true, inputMode: "decimal", opt: true, schema: decimal },
        { id: "moistureAfterPct", t: "text", l: "Moisture after, %", half: true, mono: true, right: true, inputMode: "decimal", opt: true, schema: decimal },
      ],
    },
    {
      fields: [
        { id: "observations", t: "area", l: "Observations", rows: 2, opt: true },
        { id: "abnormal", t: "toggle", l: "Something abnormal", h: "Contamination, or product that looks wrong. It holds the run for a decision." },
      ],
    },
  ],
  note: "",
  primary: "Save the stage",
  done: (_result, values) => `${String(values._stage ?? "Stage")} recorded`,
  submit: (values, ctx) => ({
    method: "POST",
    url: `/api/milling/batches/${ctx.id}/stage`,
    body: {
      stageId: values._stageId,
      shiftId: values._shiftId ?? null,
      startedAt: iso(values.startedAt),
      endedAt: iso(values.endedAt),
      inputKg: text(values.inputKg) || undefined,
      removedKg: text(values.removedKg) || undefined,
      waterLitres: text(values.waterLitres) || undefined,
      moistureBeforePct: text(values.moistureBeforePct) || undefined,
      moistureAfterPct: text(values.moistureAfterPct) || undefined,
      inputEstimated: values.inputHow !== "Weighed",
      removedEstimated: values.removedHow !== "Weighed",
      observations: text(values.observations) || null,
      abnormal: values.abnormal === true,
    },
  }),
  invalidate,
  requires: [["ext:milling", "stage.record"]],
};

/** Complete the run (PR-A2): the change in material left in the line closes the material balance. A variance over tolerance waits for management. */
const complete: SheetKind = {
  title: (_ctx, values) => `Complete ${String(values._code ?? "the run")}`,
  sub: "What is left in the machines and bins now, less what was there when the run started, closes the balance.",
  cur: "US$",
  load: async (ctx) => {
    const run = await detail(ctx.id);
    return { _code: run.batch.code, change: run.batch.inProcessChangeKg === null ? "" : String(run.batch.inProcessChangeKg) };
  },
  sections: [{ fields: [{ id: "change", t: "text", l: "Change in material in the line, kg", mono: true, right: true, inputMode: "decimal", needed: "Enter the change, 0 if none.", schema: decimal }] }],
  note: "A variance over the mill's tolerance holds the run for management.",
  primary: "Complete the run",
  done: (_result, values) => `${String(values._code ?? "Run")} completed`,
  submit: (values, ctx) => ({ method: "POST", url: `/api/milling/batches/${ctx.id}/complete`, body: { inProcessChangeKg: numberOf(values.change) ?? 0 } }),
  invalidate,
  requires: [["ext:milling", "batch.approve"]],
};

export const RUN_SHEETS: Record<string, SheetKind> = {
  "mill-run-issue": issue,
  "mill-run-output": output,
  "mill-run-stage": stage,
  "mill-run-complete": complete,
};
