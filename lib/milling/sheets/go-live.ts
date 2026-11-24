import { z } from "zod";

import { fetchJson } from "@/lib/api-client";
import type { SheetKind } from "@/lib/workspace/sheet-kind";

import { idOf, labels, text, type Choice } from "./choices";

type View = { places: Array<{ id: string; name: string }>; products: Array<{ id: string; name: string; unit: string; costPrice: number }> };
const decimal = z.string().regex(/^\d+(\.\d+)?$/, "A number.");

/** Count one item at one place on the draft opening stock, at its cost; counting it again at the same place replaces the count. */
const count: SheetKind = {
  title: "Count an item",
  sub: "Counting an item again at the same place replaces its count.",
  cur: "US$",
  load: async () => {
    const view = await fetchJson<View>("/api/milling/go-live/opening");
    const _item: Choice[] = view.products.map((row) => ({ id: row.id, label: row.name }));
    const _where: Choice[] = view.places.map((row) => ({ id: row.id, label: row.name }));
    return { _view: view, _item, _where, item: "", where: _where[0]?.label ?? "", quantity: "", cost: "" };
  },
  sections: [
    {
      fields: [
        {
          id: "item",
          t: "text",
          l: "Item",
          o: (values) => labels(values, "item"),
          needed: "Choose the item.",
          follow: async (_value, values) => {
            const product = (values._view as View).products.find((row) => row.id === idOf(values, "item"));
            return product && !values.cost ? { cost: product.costPrice ? String(product.costPrice) : "" } : {};
          },
        },
        { id: "where", t: "text", l: "Where", o: (values) => labels(values, "where"), needed: "Choose where it is." },
        { id: "quantity", t: "text", l: "Counted", half: true, mono: true, right: true, inputMode: "decimal", needed: "A count is more than nothing.", schema: decimal },
        { id: "cost", t: "money", l: "Cost each", half: true, opt: true },
      ],
    },
  ],
  note: "",
  primary: "Save the count",
  done: "Count saved",
  submit: (values) => ({
    method: "POST",
    url: "/api/milling/go-live/opening/lines",
    body: { action: "set", productId: idOf(values, "item"), stockLocationId: idOf(values, "where"), quantity: text(values.quantity), unitCost: text(values.cost) || "0" },
  }),
  invalidate: [["list"], ["milling-opening"], ["milling"]],
  requires: [["ext:milling", "stock.count"]],
};

export const GO_LIVE_SHEETS: Record<string, SheetKind> = { "mill-opening-count": count };
