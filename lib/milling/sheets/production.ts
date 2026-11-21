import { z } from "zod";

import type { MillLookups } from "@/components/milling/mill-ui";
import { fetchJson } from "@/lib/api-client";
import type { SheetKind } from "@/lib/workspace/sheet-kind";

import { idOf, labels, numberOf, text, type Choice } from "./choices";

const kg = (value: number) => `${value.toLocaleString("en-GB", { maximumFractionDigits: 1 })} kg`;

/** Start a run (PR-A1 "New run"): from an approved plan, on an open shift. Maize comes from the plan's reserved lots first. */
const runStart: SheetKind = {
  title: "Start a run",
  sub: "Maize issued to it comes from the plan's reserved lots first.",
  cur: "US$",
  load: async () => {
    const [plans, shifts] = await Promise.all([
      fetchJson<{ rows: Array<{ id: string; code: string; status: string; shiftKind: string }> }>("/api/milling/orders"),
      fetchJson<Array<{ id: string; code: string }>>("/api/milling/shifts?status=OPEN"),
    ]);
    const _plan: Choice[] = plans.rows.filter((row) => ["APPROVED", "IN_PROGRESS"].includes(row.status)).map((row) => ({ id: row.id, label: `${row.code} · ${row.shiftKind === "NIGHT" ? "Night" : "Day"}` }));
    const _shift: Choice[] = shifts.map((row) => ({ id: row.id, label: row.code }));
    return { _plan, _shift, plan: _plan[0]?.label ?? "None", shift: _shift[0]?.label ?? "None" };
  },
  sections: [
    {
      fields: [
        { id: "plan", t: "text", l: "Plan", o: (values) => labels(values, "plan", true), h: "Only approved plans can start a run." },
        { id: "shift", t: "text", l: "Shift", o: (values) => labels(values, "shift", true), h: "An open shift. The run's stages carry the shift each was done on." },
      ],
    },
  ],
  note: "The run opens at its first stage: issue the maize.",
  primary: "Start the run",
  done: (result) => `${String((result as { code?: string } | null)?.code ?? "Run")} started`,
  next: (result) => {
    const id = (result as { id?: string } | null)?.id;
    return id ? `/milling/production/${id}` : null;
  },
  submit: (values) => ({ method: "POST", url: "/api/milling/batches", body: { orderId: idOf(values, "plan"), shiftId: idOf(values, "shift") } }),
  invalidate: [["list"], ["milling"]],
  requires: [["ext:milling", "batch.run"]],
};

type Recipe = { id: string; packed: string; bulk: string; kgPerBag: number; isActive: boolean };
type StockProduct = { name: string; lots: Array<{ id: string; code: string; status: string; balances: Array<{ stockLocationId: string; location: string; quantity: number }> }> };

/** Pack (PK-A1 "New packing run"): released meal from a bulk lot into bags, with check weights against the recipe. */
const pack: SheetKind = {
  title: "Pack",
  sub: "Only released bulk can be packed. Empty bags and thread come off the oldest lots.",
  wide: true,
  cur: "US$",
  load: async () => {
    const [recipes, stock, lookups] = await Promise.all([
      fetchJson<{ rows: Recipe[] }>("/api/milling/settings/recipes"),
      fetchJson<{ products: StockProduct[] }>("/api/milling/stock"),
      fetchJson<MillLookups>("/api/milling/lookups"),
    ]);
    const active = recipes.rows.filter((row) => row.isActive);
    const bulkFor = (recipe: Recipe | undefined): Choice[] =>
      (stock.products ?? [])
        .filter((product) => product.name === recipe?.bulk)
        .flatMap((product) => product.lots.filter((lot) => lot.status === "AVAILABLE").flatMap((lot) => lot.balances.map((balance) => ({ id: `${lot.id}|${balance.stockLocationId}`, label: `${lot.code} at ${balance.location}, ${kg(balance.quantity)}` }))));
    return {
      _recipes: active,
      _bulkByRecipe: Object.fromEntries(active.map((recipe) => [recipe.packed, bulkFor(recipe)])),
      _recipe: active.map((recipe) => ({ id: recipe.id, label: recipe.packed })),
      _to: lookups.locations.map((location) => ({ id: location.id, label: `${location.code} · ${location.name}` })),
      recipe: active[0]?.packed ?? "",
      _from: bulkFor(active[0]),
      from: bulkFor(active[0])[0]?.label ?? "",
      to: "",
    };
  },
  sections: [
    {
      fields: [
        {
          id: "recipe",
          t: "text",
          l: "What is packed",
          o: (values) => labels(values, "recipe"),
          follow: async (value, values) => {
            const options = ((values._bulkByRecipe as Record<string, Choice[]> | undefined) ?? {})[String(value)] ?? [];
            return { _from: options, from: options[0]?.label ?? "" };
          },
        },
        { id: "from", t: "text", l: "From lot", o: (values) => labels(values, "from"), h: "Released lots of the recipe's bulk, where they are." },
        { id: "to", t: "text", l: "Packed bags go to", o: (values) => labels(values, "to") },
      ],
    },
    {
      title: "What was packed",
      fields: [
        { id: "bags", t: "text", l: "Bags packed", half: true, mono: true, right: true, inputMode: "numeric", schema: z.string().regex(/^\d+$/, "Bags are a whole number.") },
        { id: "damaged", t: "text", l: "Damaged bags", half: true, mono: true, right: true, inputMode: "numeric", opt: true, schema: z.string().regex(/^\d+$/, "Bags are a whole number.") },
        {
          id: "bulkKg",
          t: "text",
          l: "Bulk used, kg",
          mono: true,
          right: true,
          inputMode: "decimal",
          h: (values) => {
            const recipe = ((values._recipes as Recipe[] | undefined) ?? []).find((row) => row.packed === values.recipe);
            const bags = numberOf(values.bags);
            return recipe && bags ? `The bags hold ${kg(bags * Number(recipe.kgPerBag))} by the recipe.` : "Weighed off the bulk bin.";
          },
        },
        { id: "checks", t: "text", l: "Check weights, kg", mono: true, opt: true, p: "10.02, 9.98, 10.05", h: "A sample of bags off the line, comma separated." },
      ],
    },
  ],
  note: "Light check weights show on the packing run.",
  primary: "Save",
  done: (result) => `${String((result as { code?: string } | null)?.code ?? "Packing run")} recorded`,
  submit: (values) => {
    const [bulkLotId, bulkLocationId] = String(idOf(values, "from") ?? "|").split("|");
    return {
      method: "POST",
      url: "/api/milling/packing",
      body: {
        recipeId: idOf(values, "recipe"),
        bulkLotId,
        bulkLocationId,
        outputLocationId: idOf(values, "to"),
        bagsPacked: text(values.bags),
        damagedBags: text(values.damaged) || 0,
        bulkUsedKg: text(values.bulkKg),
        checkWeights: text(values.checks).split(",").map((part) => part.trim()).filter(Boolean),
      },
    };
  },
  invalidate: [["list"], ["milling"]],
  requires: [["ext:milling", "stage.record"]],
};

export const PRODUCTION_SHEETS: Record<string, SheetKind> = {
  "mill-run-start": runStart,
  "mill-pack": pack,
};
