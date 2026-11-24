import { z } from "zod";

import type { MillLookups } from "@/components/milling/mill-ui";
import { fetchJson } from "@/lib/api-client";
import type { SheetKind, SheetValues } from "@/lib/workspace/sheet-kind";

import { idOf, labels, NONE, numberOf, text, type Choice } from "./choices";

const decimal = z.string().regex(/^\d+(\.\d+)?$/, "A number.");
const whole = z.string().regex(/^\d+$/, "A whole number.");
const invalidate = [["list"], ["reports"], ["milling"]];
const kg = (value: number) => `${value.toLocaleString("en-GB", { maximumFractionDigits: 1 })} kg`;

const METHOD: Record<string, string> = { "Bag count": "BAG_COUNT", "Weighbridge ticket": "EXTERNAL_TICKET", "Supplier's weight": "SUPPLIER_DECLARED" };

function netOf(values: SheetValues) {
  if (values.method === "Bag count") return (numberOf(values.bags) ?? 0) * (text(values.bagKg) ? (numberOf(values.bagKg) ?? 0) : Number(values._bagKg ?? 50));
  if (values.method === "Weighbridge ticket") return values.grossKg && values.tareKg ? (numberOf(values.grossKg) ?? 0) - (numberOf(values.tareKg) ?? 0) : 0;
  return numberOf(values.netKg) ?? 0;
}

const netWords = (values: SheetValues) => {
  const net = netOf(values);
  return net > 0 ? `Net ${kg(net)}` : "";
};

/** Record a delivery at the gate (IN-B1): who brought the maize, and what it weighed. Opens the new ticket when saved. */
const intakeNew: SheetKind = {
  title: "Record a delivery",
  sub: "Who brought the maize and what it weighed. Only a weighbridge ticket makes the weight verified.",
  wide: true,
  cur: "US$",
  load: async () => {
    const lookups = await fetchJson<MillLookups>("/api/milling/lookups");
    const grains: Choice[] = lookups.products.filter((row) => row.unit === "KILOGRAM").map((row) => ({ id: row.id, label: row.name }));
    const maize = lookups.products.find((row) => row.code === "MAIZE");
    const stores: Choice[] = lookups.locations.filter((row) => ["STORE", "BIN", "SILO", "DOCK"].includes(row.kind)).map((row) => ({ id: row.id, label: `${row.code} · ${row.name}` }));
    return {
      _grain: grains,
      grain: grains.find((row) => row.id === maize?.id)?.label ?? grains[0]?.label ?? "",
      _bin: stores,
      bin: NONE,
      _suppliers: lookups.vendors.map((row) => row.name),
      _bagKg: lookups.defaultIntakeBagKg,
      method: "Bag count",
    };
  },
  sections: [
    {
      title: "Who brought it",
      fields: [
        { id: "supplier", t: "text", l: "Supplier", needed: "Who delivered it?", h: (values) => ((values._suppliers as string[] | undefined)?.length ? `Known: ${(values._suppliers as string[]).slice(0, 4).join(", ")}${(values._suppliers as string[]).length > 4 ? "…" : ""}` : "") },
        { id: "grain", t: "text", l: "Grain", o: (values) => labels(values, "grain"), show: (values) => labels(values, "grain").length > 1 },
        { id: "vehicle", t: "text", l: "Vehicle", half: true, upper: true, opt: true },
        { id: "driver", t: "text", l: "Driver", half: true, opt: true },
        { id: "deliveryRef", t: "text", l: "Delivery note", half: true, opt: true },
        { id: "variety", t: "text", l: "Variety", half: true, opt: true, p: "e.g. SC 727" },
      ],
    },
    {
      title: "What it weighed",
      fields: [
        {
          id: "method",
          t: "seg",
          l: "How it was weighed",
          o: Object.keys(METHOD),
          h: (values) => (values.method === "Weighbridge ticket" ? "The ticket makes the weight verified." : "Provisional until a weighbridge ticket confirms it."),
        },
        { id: "bags", t: "text", l: "Bags", half: true, mono: true, right: true, inputMode: "numeric", schema: whole, needed: "How many bags?", h: (values) => netWords(values), show: (values) => values.method === "Bag count" },
        { id: "bagKg", t: "text", l: "Kg a bag", half: true, mono: true, right: true, inputMode: "decimal", opt: true, schema: decimal, p: "50", h: (values) => `Usual: ${String(values._bagKg ?? 50)} kg`, show: (values) => values.method === "Bag count" },
        { id: "ticket", t: "text", l: "Ticket", half: true, show: (values) => values.method === "Weighbridge ticket", needed: "The ticket number." },
        { id: "grossKg", t: "text", l: "Gross kg", half: true, mono: true, right: true, inputMode: "decimal", schema: decimal, needed: "The gross weight.", show: (values) => values.method === "Weighbridge ticket" },
        { id: "tareKg", t: "text", l: "Tare kg", half: true, mono: true, right: true, inputMode: "decimal", schema: decimal, needed: "The tare weight.", h: (values) => netWords(values), show: (values) => values.method === "Weighbridge ticket" },
        { id: "netKg", t: "text", l: "Declared net kg", mono: true, right: true, inputMode: "decimal", schema: decimal, needed: "The weight they declared.", show: (values) => values.method === "Supplier's weight" },
      ],
    },
    {
      title: "Price and store",
      fields: [
        { id: "price", t: "money", l: "Price a tonne", half: true, opt: true, h: "If agreed at the gate: it values the lot and goes on the supplier's bill." },
        { id: "bin", t: "text", l: "Goes into", half: true, o: (values) => labels(values, "bin", true), opt: true, h: "Can be chosen when QC decides." },
        { id: "notes", t: "area", l: "Notes", rows: 2, opt: true },
      ],
    },
  ],
  note: "",
  primary: "Record delivery",
  done: (result) => `${String((result as { code?: string } | null)?.code ?? "Ticket")} recorded`,
  next: (result) => ((result as { id?: string } | null)?.id ? `/milling/intake/${(result as { id: string }).id}` : null),
  submit: (values) => ({
    method: "POST",
    url: "/api/milling/intakes",
    body: {
      productId: idOf(values, "grain"),
      supplierName: text(values.supplier),
      vehicleReg: text(values.vehicle),
      driverName: text(values.driver),
      deliveryRef: text(values.deliveryRef),
      variety: text(values.variety),
      weighMethod: METHOD[String(values.method)] ?? "BAG_COUNT",
      bags: text(values.bags),
      bagKg: text(values.bagKg),
      ticketNumber: text(values.ticket),
      grossKg: text(values.grossKg),
      tareKg: text(values.tareKg),
      netKg: text(values.netKg),
      pricePerTonne: text(values.price),
      binLocationId: idOf(values, "bin"),
      notes: text(values.notes),
    },
  }),
  invalidate,
  requires: [["ext:milling", "intake.record"]],
};

type Routes = { customers: Array<{ id: string; name: string; area: string | null }> };

/** A shop visit (HM-D1): the competitor's price, our bags on the shelf, our share, a photo and a note. Only the shop is required. */
const visitNew: SheetKind = {
  title: (_ctx, values) => (values.shop ? `Visit ${String(values.shop)}` : "Record a visit"),
  sub: "Only the shop is needed; the rest is the market survey.",
  cur: "US$",
  load: async (ctx) => {
    const data = await fetchJson<Routes>("/api/milling/routes");
    const shops: Choice[] = data.customers.map((row) => ({ id: row.id, label: row.area ? `${row.name}, ${row.area}` : row.name }));
    const given = ctx.params.get("customer");
    return { _shop: shops, shop: shops.find((row) => row.id === given)?.label ?? "" };
  },
  sections: [
    {
      fields: [
        { id: "shop", t: "text", l: "Shop", o: (values) => labels(values, "shop"), needed: "Choose the shop." },
        { id: "price", t: "money", l: "Their price, a bag", half: true, opt: true },
        { id: "bags", t: "text", l: "Our bags on the shelf", half: true, mono: true, right: true, inputMode: "numeric", opt: true, schema: whole },
        { id: "share", t: "text", l: "Our shelf share, %", half: true, mono: true, right: true, inputMode: "decimal", opt: true, schema: decimal.refine((value) => Number(value) <= 100, "Up to 100%.") },
        { id: "photo", t: "photo", l: "Photo", opt: true, upload: "/api/milling/uploads/visit-photo" },
        { id: "note", t: "area", l: "Note", rows: 2, opt: true },
      ],
    },
  ],
  note: "",
  primary: "Save visit",
  done: "Visit saved",
  submit: (values) => ({
    method: "POST",
    url: "/api/milling/customers/visits",
    body: {
      customerId: idOf(values, "shop"),
      competitorPrice: text(values.price) === "" ? null : numberOf(values.price),
      ourBagsOnShelf: text(values.bags) === "" ? null : numberOf(values.bags),
      shelfSharePct: text(values.share) === "" ? null : numberOf(values.share),
      photoUrl: typeof values.photo === "string" && values.photo ? values.photo : null,
      note: text(values.note) || null,
    },
  }),
  invalidate: [["list"], ["reports"], ["milling"]],
  requires: [["ext:milling", "visit.record"]],
};

export const FORM_SHEETS: Record<string, SheetKind> = { "mill-intake-new": intakeNew, "mill-visit-new": visitNew };
