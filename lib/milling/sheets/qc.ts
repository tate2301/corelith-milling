import { z } from "zod";

import type { MillLookups } from "@/components/milling/mill-ui";
import { fetchJson } from "@/lib/api-client";
import type { SheetCtx, SheetKind, SheetValues } from "@/lib/workspace/sheet-kind";

import { idOf, labels, numberOf, text, type Choice } from "./choices";
import { slotFields, slotItems } from "./slots";

type Spec = MillLookups["specs"][number];
const SLOTS = 20;
const METHOD: Record<string, string> = { VISUAL: "Visual", INSTRUMENT: "Instrument", EXTERNAL_LAB: "External lab", NOT_PERFORMED: "Not performed" };
const limit = (spec: Spec) => (spec.maxValue !== null ? ` · limit ${spec.minValue !== null ? `${spec.minValue}–` : "≤ "}${spec.maxValue}${spec.unit ?? ""}` : "");

/**
 * Take the sample (QT-A2, PH-J1): each check of the spec, how it was done,
 * and the reading or the pass. Not performed is never a pass: a required
 * check not performed holds the lot for management.
 */
function inspect(target: "intake" | "lot"): SheetKind {
  const point = target === "intake" ? "INCOMING_MAIZE" : "FINISHED_PRODUCT";
  return {
    title: (_ctx, values) => `Test ${String(values._code ?? "")}`.trim(),
    sub: target === "intake" ? "The sample from the delivery, against the incoming maize spec." : "A sample of the lot, against the product spec.",
    wide: true,
    cur: "US$",
    load: async (ctx: SheetCtx) => {
      const lookups = await fetchJson<MillLookups>("/api/milling/lookups");
      const specs = lookups.specs.filter((spec) => spec.point === point).slice(0, SLOTS);
      return {
        _code: ctx.params.get("code") ?? "",
        _specs: specs,
        _checks: specs.map((spec) => ({ id: spec.id, name: `${spec.name}${spec.required ? "" : " (optional)"}`, sub: `${spec.guidance ?? ""}${limit(spec)}`.replace(/^ · /, "") })),
        ...Object.fromEntries(specs.flatMap((spec, index) => [[`m${index}`, METHOD[spec.method] ?? spec.method], [`v${index}`, ""], [`p${index}`, "Pass"]])),
      };
    },
    sections: [
      {
        fields: slotFields("checks", SLOTS, (index, item) => {
          const spec = (values: SheetValues) => ((values._specs as Spec[] | undefined) ?? [])[index];
          return [
            { id: `m${index}`, t: "seg", l: "", lw: (values) => item(values)?.name ?? "", h: (values) => item(values)?.sub ?? "", half: true, o: (values) => [METHOD[spec(values)?.method ?? ""] ?? "Visual", "Not performed"] },
            {
              id: `v${index}`,
              t: "text",
              l: "Reading",
              lw: (values) => `Reading${spec(values)?.unit ? `, ${spec(values)?.unit}` : ""}`,
              half: true,
              mono: true,
              right: true,
              inputMode: "decimal",
              opt: true,
              optQuiet: true,
              show: (values) => spec(values)?.resultType === "NUMERIC",
              disabled: (values) => values[`m${index}`] === "Not performed",
              schema: z.string().regex(/^-?\d+(\.\d+)?$/, "A number."),
            },
            { id: `p${index}`, t: "seg", l: "Result", half: true, o: ["Pass", "Fail"], show: (values) => spec(values)?.resultType !== "NUMERIC", disabled: (values) => values[`m${index}`] === "Not performed" },
          ];
        }),
      },
    ],
    note: "A reading outside the limit, or a required check not performed, holds the lot for a decision.",
    primary: "Save the test",
    done: "Test saved",
    submit: (values, ctx) => ({
      method: "POST",
      url: target === "intake" ? `/api/milling/intakes/${ctx.id}/inspect` : `/api/milling/lots/${ctx.id}/inspect`,
      body: {
        results: slotItems(values, "checks").map((check, index) => {
          const spec = ((values._specs as Spec[] | undefined) ?? [])[index]!;
          const skipped = values[`m${index}`] === "Not performed";
          return {
            specId: check.id,
            method: skipped ? "NOT_PERFORMED" : spec.method,
            value: spec.resultType === "NUMERIC" && !skipped ? text(values[`v${index}`]) || null : null,
            passed: spec.resultType !== "NUMERIC" && !skipped ? values[`p${index}`] === "Pass" : null,
            note: null,
          };
        }),
      },
    }),
    invalidate: [["list"], ["reports"], ["milling"], [`milling-${target}`]],
    requires: [["ext:milling", "qc.record"]],
  };
}

const INTAKE_DECISION: Record<string, string> = { Accept: "ACCEPT", Hold: "HOLD", Reject: "REJECT" };

/** Decide a delivery (AP-A6): accept it into a bin, hold it, or reject it. Rejecting needs a reason. */
const intakeDecide: SheetKind = {
  title: (_ctx, values) => `Decide ${String(values._code ?? "the delivery")}`,
  sub: "Accepted maize goes into the bin as a lot. Held maize waits for a decision; rejected maize is sent back.",
  cur: "US$",
  load: async (ctx) => {
    const lookups = await fetchJson<MillLookups>("/api/milling/lookups");
    const _bin: Choice[] = lookups.locations.filter((row) => ["BIN", "SILO", "STORE"].includes(row.kind)).map((row) => ({ id: row.id, label: `${row.code} · ${row.name}` }));
    return { _code: ctx.params.get("code") ?? "", _bin, decision: "Accept", bin: _bin[0]?.label ?? "" };
  },
  sections: [
    {
      fields: [
        { id: "decision", t: "seg", l: "Decision", o: Object.keys(INTAKE_DECISION) },
        { id: "bin", t: "text", l: "Into", o: (values) => labels(values, "bin"), show: (values) => values.decision === "Accept", needed: "Choose the bin it goes into." },
        { id: "note", t: "area", l: "Note", rows: 2, opt: true, h: (values) => (values.decision === "Reject" ? "Say why it is rejected: the supplier is told." : "Kept with the delivery.") },
      ],
    },
  ],
  note: "",
  primary: (values) => (values.decision === "Reject" ? "Reject" : values.decision === "Hold" ? "Hold" : "Accept"),
  done: (_result, values) => `${String(values._code ?? "Delivery")}: ${values.decision === "Hold" ? "held" : values.decision === "Reject" ? "rejected" : "accepted"}`,
  submit: (values, ctx) => ({ method: "POST", url: `/api/milling/intakes/${ctx.id}/decide`, body: { decision: INTAKE_DECISION[String(values.decision)] ?? "ACCEPT", binLocationId: values.decision === "Accept" ? idOf(values, "bin") : null, note: text(values.note) || null } }),
  invalidate: [["list"], ["reports"], ["milling"], ["milling-intake"]],
  requires: [["ext:milling", "qc.decide"]],
};

const LOT_DECISION: Record<string, string> = { Release: "RELEASE", "Keep on hold": "HOLD", Reject: "REJECT" };

/** Decide a lot (QT-A2): release it for use, keep it on hold, or reject and dispose of it. Rejecting needs a reason. */
const lotDecide: SheetKind = {
  title: (_ctx, values) => `Decide ${String(values._code ?? "the lot")}`,
  sub: "Released product can be packed and sold. Rejected product is disposed of and comes off stock.",
  cur: "US$",
  load: async (ctx) => ({ _code: ctx.params.get("code") ?? "", decision: "Release" }),
  sections: [
    {
      fields: [
        { id: "decision", t: "seg", l: "Decision", o: Object.keys(LOT_DECISION) },
        { id: "note", t: "area", l: "Note", rows: 2, opt: true, h: (values) => (values.decision === "Reject" ? "Say why it is rejected." : "Kept with the lot.") },
      ],
    },
  ],
  note: "",
  primary: (values) => String(values.decision ?? "Release"),
  done: (_result, values) => `${String(values._code ?? "Lot")}: ${String(values.decision ?? "").toLowerCase()}`,
  submit: (values, ctx) => ({ method: "POST", url: `/api/milling/lots/${ctx.id}/decide`, body: { decision: LOT_DECISION[String(values.decision)] ?? "RELEASE", note: text(values.note) || null } }),
  invalidate: [["list"], ["reports"], ["milling"], ["milling-lot"]],
  requires: [["ext:milling", "qc.decide"]],
};

/** Confirm a provisional weight (IN-B4): the weighbridge ticket and its weights. The original is kept on the record's history. */
const confirmWeight: SheetKind = {
  title: (_ctx, values) => `Confirm the weight of ${String(values._code ?? "the delivery")}`,
  sub: "The weighbridge ticket replaces the provisional weight. The old figure stays on the history.",
  cur: "US$",
  load: async (ctx) => ({ _code: ctx.params.get("code") ?? "" }),
  sections: [
    {
      fields: [
        { id: "ticket", t: "text", l: "Ticket number", mono: true, needed: "Enter the weighbridge ticket number." },
        { id: "gross", t: "text", l: "Gross, kg", half: true, mono: true, right: true, inputMode: "decimal", opt: true },
        { id: "tare", t: "text", l: "Tare, kg", half: true, mono: true, right: true, inputMode: "decimal", opt: true },
        { id: "reason", t: "text", l: "Where the ticket is from", p: "Mhondoro weighbridge", needed: "Say where the confirmed weight comes from." },
      ],
    },
  ],
  note: (values) => {
    const gross = numberOf(values.gross);
    const tare = numberOf(values.tare);
    if (gross === null || tare === null) return "";
    return tare >= gross ? "Tare is above gross." : `Net ${(gross - tare).toLocaleString("en-GB")} kg.`;
  },
  noteBad: (values) => (numberOf(values.tare) ?? 0) >= (numberOf(values.gross) ?? Infinity),
  primary: "Confirm the weight",
  done: "Weight confirmed",
  submit: (values, ctx) => ({ method: "POST", url: `/api/milling/intakes/${ctx.id}/confirm-weight`, body: { ticketNumber: text(values.ticket), grossKg: text(values.gross), tareKg: text(values.tare), reason: text(values.reason) } }),
  invalidate: [["list"], ["reports"], ["milling"], ["milling-intake"]],
  requires: [["ext:milling", "intake.record"]],
};

/** Bill the supplier (Books): a purchase bill for the accepted maize at the agreed price a tonne. */
const bill: SheetKind = {
  title: (_ctx, values) => `Bill for ${String(values._code ?? "the delivery")}`,
  sub: "A purchase bill to the supplier in Books, for the accepted kilograms at the price a tonne.",
  cur: "US$",
  load: async (ctx) => ({ _code: ctx.params.get("code") ?? "", price: ctx.params.get("price") ?? "" }),
  sections: [{ fields: [{ id: "price", t: "money", l: "Price a tonne", needed: "Enter the price agreed a tonne." }] }],
  note: "",
  primary: "Bill the supplier",
  done: "Bill drafted in Books",
  submit: (values, ctx) => ({ method: "POST", url: `/api/milling/intakes/${ctx.id}/bill`, body: { pricePerTonne: text(values.price) } }),
  invalidate: [["list"], ["reports"], ["milling"], ["milling-intake"]],
  requires: [["ext:milling", "intake.record"]],
};

export const QC_SHEETS: Record<string, SheetKind> = {
  "mill-intake-inspect": inspect("intake"),
  "mill-lot-inspect": inspect("lot"),
  "mill-intake-decide": intakeDecide,
  "mill-lot-decide": lotDecide,
  "mill-intake-weight": confirmWeight,
  "mill-intake-bill": bill,
};
