import { z } from "zod";

import type { MillLookups } from "@/components/milling/mill-ui";
import { fetchJson } from "@/lib/api-client";
import type { SheetKind, SheetValues } from "@/lib/workspace/sheet-kind";

import { idOf, labels, numberOf, text, type Choice } from "./choices";
import { slotFields, slotItems, type Slot } from "./slots";

type StockProduct = { name: string; unit: string; lots: Array<{ id: string; code: string; status: string; balances: Array<{ stockLocationId: string; location: string; quantity: number; reserved: number }> }> };
const SLOTS = 40;
const decimal = z.string().regex(/^\d+(\.\d+)?$/, "A number.");
const invalidate = [["list"], ["reports"], ["milling"]];
const stock = () => fetchJson<{ products: StockProduct[] }>("/api/milling/stock");
const places = async (): Promise<Choice[]> => (await fetchJson<MillLookups>("/api/milling/lookups")).locations.map((row) => ({ id: row.id, label: `${row.code} · ${row.name}` }));

/** Move some of a lot to another place (a bin to a store, a store to the line). */
const move: SheetKind = {
  title: (_ctx, values) => `Move ${String(values._code ?? "the lot")}`,
  sub: (_ctx, values) => `${String(values._has ?? "")} at ${String(values._from ?? "its place")}.`,
  cur: "US$",
  load: async (ctx) => {
    const [lotId, fromId] = String(ctx.id ?? "").split("~");
    const [data, _to] = await Promise.all([stock(), places()]);
    const lot = data.products.flatMap((product) => product.lots.map((row) => ({ ...row, product }))).find((row) => row.id === lotId);
    const balance = lot?.balances.find((row) => row.stockLocationId === fromId);
    const free = balance ? balance.quantity - balance.reserved : 0;
    return {
      _code: lot?.code ?? "",
      _lotId: lotId,
      _fromId: fromId,
      _from: balance?.location ?? "",
      _has: balance ? `${balance.quantity.toLocaleString("en-GB")} ${lot?.product.unit === "BAG" ? "bags" : "kg"}${balance.reserved ? `, ${balance.reserved.toLocaleString("en-GB")} reserved` : ""}` : "",
      _to: _to.filter((option) => option.id !== fromId),
      to: _to.find((option) => option.id !== fromId)?.label ?? "",
      quantity: free > 0 ? String(free) : "",
      how: "Weighed",
    };
  },
  sections: [
    {
      fields: [
        { id: "to", t: "text", l: "To", o: (values) => labels(values, "to"), needed: "Choose where it goes." },
        { id: "quantity", t: "text", l: "How much", half: true, mono: true, right: true, inputMode: "decimal", needed: "Move more than nothing.", schema: decimal },
        { id: "how", t: "seg", l: "The figure is", half: true, o: ["Weighed", "Estimated"] },
      ],
    },
  ],
  note: "",
  primary: "Move",
  done: (_result, values) => `${String(values._code ?? "Lot")} moved`,
  submit: (values) => ({ method: "POST", url: "/api/milling/stock/move", body: { lotId: values._lotId, fromLocationId: values._fromId, toLocationId: idOf(values, "to"), quantity: text(values.quantity), isEstimated: values.how === "Estimated" } }),
  invalidate,
  requires: [["ext:milling", "stock.move"]],
};

function lotsAt(data: { products: StockProduct[] }, placeId: string | null): Slot[] {
  if (!placeId) return [];
  return data.products.flatMap((product) => product.lots.filter((lot) => lot.balances.some((row) => row.stockLocationId === placeId)).map((lot) => ({ id: lot.id, name: lot.code, sub: product.name }))).slice(0, SLOTS);
}

/**
 * Count a place (SC-B1): every lot the ledger has there, counted blind (the
 * ledger's figure is not shown). A count that is off waits for management.
 */
const count: SheetKind = {
  title: "Count a place",
  sub: "Count what is there. The ledger's figures are not shown; a count that is off waits for management before it posts.",
  wide: true,
  cur: "US$",
  load: async () => {
    const [data, _place] = await Promise.all([stock(), places()]);
    const first = _place[0];
    return { _stock: data, _place, place: first?.label ?? "", _lots: lotsAt(data, first?.id ?? null) };
  },
  sections: [
    {
      fields: [
        {
          id: "place",
          t: "text",
          l: "Place",
          o: (values) => labels(values, "place"),
          follow: async (_value, values) => ({ _lots: lotsAt(values._stock as { products: StockProduct[] }, idOf(values, "place")) }),
        },
      ],
    },
    {
      title: "Counted",
      fields: [
        { id: "_none", t: "read", l: "", nolabel: true, v: "The ledger has nothing at this place.", show: (values) => !slotItems(values, "lots").length },
        ...slotFields("lots", SLOTS, (index, item) => [{ id: `counted${index}`, t: "text", l: "", lw: (values) => `${item(values)?.name ?? ""}, ${item(values)?.sub ?? ""}`, half: true, mono: true, right: true, inputMode: "decimal", schema: decimal }]),
      ],
    },
  ],
  note: "",
  primary: "Save the count",
  primaryDisabled: (values) => !slotItems(values, "lots").length,
  done: (result) => ((result as { status?: string } | null)?.status === "AWAITING_DECISION" ? "Count saved. It is off, so it waits for management." : "Count posted"),
  submit: (values: SheetValues) => ({
    method: "POST",
    url: "/api/milling/stock/counts",
    body: { stockLocationId: idOf(values, "place"), lines: slotItems(values, "lots").map((lot, index) => ({ lotId: lot.id, counted: numberOf(values[`counted${index}`]) ?? 0 })) },
  }),
  invalidate,
  requires: [["ext:milling", "stock.count"]],
};

/** Match the gate's till sales to lots: each bag sold at the till comes off the oldest released lot of its product. */
const matchGateSales: SheetKind = {
  title: "Match gate sales to lots",
  sub: "Each bag sold at the gate till comes off the oldest released lot of its product. Sales already matched are left alone.",
  cur: "US$",
  sections: [{ fields: [{ id: "_what", t: "read", l: "", nolabel: true, v: "Runs over every gate sale not yet matched." }] }],
  note: "",
  primary: "Match them",
  done: (result) => {
    const matched = Number((result as { matched?: number } | null)?.matched ?? 0);
    return matched ? `${matched} gate ${matched === 1 ? "sale" : "sales"} matched to lots` : "Nothing new to match";
  },
  submit: () => ({ method: "POST", url: "/api/milling/gate-sales", body: {} }),
  invalidate,
  requires: [["ext:milling", "stock.move"]],
};

export const STOCK_SHEETS: Record<string, SheetKind> = {
  "mill-lot-move": move,
  "mill-count-place": count,
  "mill-match-gate-sales": matchGateSales,
};
