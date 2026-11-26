import { z } from "zod";

import type { MillLookups } from "@/components/milling/mill-ui";
import { fetchJson } from "@/lib/api-client";
import type { SheetKind, SheetValues } from "@/lib/workspace/sheet-kind";

import { idOf, labels, numberOf, text } from "./choices";

/**
 * Record a production run (Grandmeal spec, Stage 1): the product scanned by
 * its barcode or picked, the bags made, the batch number and the date
 * produced. The recipe's maize and packaging come off stock; production
 * enters the maize actually used only when it differs. No costs are shown.
 */

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const kg = (value: number) => `${value.toLocaleString("en-GB", { maximumFractionDigits: 1 })} kg`;
type Picked = { id: string; label: string; kgPerBag: number | null };

function recipeKg(values: SheetValues) {
  const product = ((values._product as Picked[] | undefined) ?? []).find((row) => row.label === values.product);
  const bags = numberOf(values.bags);
  return product?.kgPerBag && bags ? product.kgPerBag * bags : null;
}

const run: SheetKind = {
  title: "Record a production run",
  sub: "The recipe's maize and packaging come off stock, oldest first. The bags land in the store under the batch number, ready to sell.",
  cur: "US$",
  load: async () => {
    const [lookups, recipes] = await Promise.all([
      fetchJson<MillLookups>("/api/milling/lookups"),
      fetchJson<{ rows: Array<{ packedProductId: string; kgPerBag: number | null; isActive: boolean }> }>("/api/milling/settings/recipes"),
    ]);
    const products: Picked[] = lookups.products
      .filter((product) => product.unit === "BAG")
      .map((product) => ({ id: product.id, label: product.name, kgPerBag: recipes.rows.find((row) => row.packedProductId === product.id && row.isActive)?.kgPerBag ?? null }));
    // The finished-goods store (Factory store) first: that is where bags land.
    const finished = (location: { code: string; name: string }) => location.code === "FG" || /finished|factory store/i.test(location.name);
    const stores = lookups.locations
      .filter((location) => location.kind === "STORE")
      .sort((a, b) => Number(finished(b)) - Number(finished(a)))
      .map((location) => ({ id: location.id, label: `${location.code} · ${location.name}` }));
    return { _product: products, _store: stores, store: stores[0]?.label ?? "", produced: today() };
  },
  sections: [
    {
      fields: [
        {
          id: "scan",
          t: "text",
          l: "Scan the barcode",
          opt: true,
          optQuiet: true,
          p: "Scan, or choose below",
          follow: async (value, values) => {
            const code = text(value);
            if (!code) return null;
            const found = await fetchJson<{ product: { id: string; name: string } | null }>(`/api/milling/production-runs/scan?code=${encodeURIComponent(code)}`);
            const match = ((values._product as Picked[] | undefined) ?? []).find((row) => row.id === found.product?.id);
            return match ? { product: match.label, scan: "" } : { scan: code };
          },
        },
        { id: "product", t: "text", l: "Product", o: (values) => labels(values, "product"), needed: "Scan or choose the product." },
        { id: "bags", t: "text", l: "Bags made", half: true, mono: true, right: true, inputMode: "numeric", schema: z.string().regex(/^[1-9]\d*$/, "A whole number of bags."), needed: "How many bags?" },
        { id: "batch", t: "text", l: "Batch number", half: true, upper: true, mono: true, needed: "The batch number on the bags.", max: 40 },
        { id: "produced", t: "date", l: "Date produced", half: true, latest: "today", needed: "The date produced." },
        { id: "store", t: "text", l: "Into", half: true, o: (values) => labels(values, "store"), needed: "Choose the store." },
        {
          id: "actualKg",
          t: "text",
          l: "Maize actually used",
          opt: true,
          mono: true,
          right: true,
          inputMode: "decimal",
          schema: z.string().regex(/^\d+(\.\d{1,3})?$/, "Kilograms."),
          p: "kg",
          h: (values) => {
            const recipe = recipeKg(values);
            if (recipe === null) return "Only when it differs from the recipe.";
            const actual = numberOf(values.actualKg);
            if (actual === null || values.actualKg === "") return `The recipe uses ${kg(recipe)}. Enter the actual only when it differs.`;
            const off = actual - recipe;
            return off === 0 ? "As the recipe." : `${kg(Math.abs(off))} ${off > 0 ? "over" : "under"} the recipe, kept as yield variance.`;
          },
        },
      ],
    },
  ],
  note: "",
  primary: "Record run",
  done: (result) => `${String((result as { batchNumber?: string } | null)?.batchNumber ?? "Run")} recorded`,
  submit: (values) => ({
    method: "POST",
    url: "/api/milling/production-runs",
    body: {
      productId: idOf(values, "product"),
      bags: numberOf(values.bags),
      batchNumber: text(values.batch),
      producedOn: values.produced,
      stockLocationId: idOf(values, "store"),
      actualInputKg: text(values.actualKg) ? numberOf(values.actualKg) : null,
    },
  }),
  invalidate: [["list"], ["milling"], ["reports"]],
  requires: [["ext:milling", "production.run"]],
};

const TREATMENT: Record<string, string> = { "Cost of sales": "COST_OF_SALES", "Operating expense": "OPERATING_EXPENSE", Asset: "ASSET" };

/** Accounting sets the cost treatment of the ticked items. */
const costTreatment: SheetKind = {
  title: (ctx) => {
    const count = (ctx.params.get("ids") ?? ctx.id ?? "").split(",").filter(Boolean).length;
    return count === 1 ? "Set the cost treatment" : `Set the cost treatment of ${count} items`;
  },
  sub: "Cost of sales rolls into the cost of each bag; an operating expense comes off below gross profit; an asset stays on the balance sheet until used.",
  cur: "US$",
  load: async () => ({ treatment: "Cost of sales" }),
  sections: [{ fields: [{ id: "treatment", t: "seg", l: "Treatment", o: Object.keys(TREATMENT) }] }],
  note: "",
  primary: "Set treatment",
  secondary: "Cancel",
  done: () => "Cost treatment set",
  submit: (values, ctx) => ({ method: "POST", url: "/api/milling/cost-treatments", body: { ids: (ctx.params.get("ids") ?? ctx.id ?? "").split(",").filter(Boolean), treatment: TREATMENT[String(values.treatment)] ?? "COST_OF_SALES" } }),
  invalidate: [["list"]],
  requires: [["ext:milling", "cost.set"]],
};

export const PRODUCTION_RUN_SHEETS: Record<string, SheetKind> = {
  "mill-production-run": run,
  "mill-cost-treatment": costTreatment,
};
