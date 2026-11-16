"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import { useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { Field, FormError } from "@/components/milling/form-bits";
import { formatKg, formatWhen, MillSelect, useMillLookups } from "@/components/milling/mill-ui";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { useMillPost } from "@/components/milling/use-mill-post";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/api-client";

type Run = { id: string; code: string; product: string; bulkLot: string; bagsPacked: number; damagedBags: number; bulkUsedKg: number; varianceKg: number; packedAt: string; checks: { samples: number; averageKg: number; giveawayPerBagKg: number; under: number } | null };
type Recipe = { id: string; packed: string; bulk: string; kgPerBag: number; isActive: boolean };
type StockProduct = { id: string; name: string; lots: Array<{ id: string; code: string; status: string; balances: Array<{ stockLocationId: string; location: string; quantity: number }> }> };

/** Pack runs: bulk product and bags in, packed bags out, with giveaway and check weights. */
export default function MillPackingPage() {
  const access = useMillAccess();
  const query = useQuery({ queryKey: ["milling", "packing"], queryFn: () => fetchJson<Run[]>("/api/milling/packing") });
  return (
    <>
      <PageChrome title="Packing" />
      <div className="space-y-4 px-4 py-2">
        <div className="flex justify-end">{access.can("stage.record") ? <PackRun /> : null}</div>
        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : !query.data?.length ? (
          <EmptyState title="Nothing packed yet" body="Pack released bulk product into bags; each run makes a lot of packed stock." />
        ) : (
          <Table hideControlsWhenSinglePage>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>From lot</TableHead>
                <TableHead className="text-right">Bags</TableHead>
                <TableHead className="text-right">Damaged</TableHead>
                <TableHead className="text-right">Bulk used</TableHead>
                <TableHead className="text-right">Giveaway</TableHead>
                <TableHead className="text-right">Check weights</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="whitespace-nowrap font-mono">{run.code}</TableCell>
                  <TableCell>{run.product}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono">{run.bulkLot}</TableCell>
                  <TableCell className="text-right font-mono">{run.bagsPacked}</TableCell>
                  <TableCell className="text-right font-mono">{run.damagedBags || "—"}</TableCell>
                  <TableCell className="text-right font-mono">{formatKg(Number(run.bulkUsedKg))}</TableCell>
                  <TableCell className="text-right font-mono">{formatKg(Number(run.varianceKg))}</TableCell>
                  <TableCell className="text-right font-mono">{run.checks ? `${run.checks.averageKg} kg avg, ${run.checks.under} under` : "—"}</TableCell>
                  <TableCell>{formatWhen(run.packedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}

function PackRun() {
  const lookups = useMillLookups();
  const [open, setOpen] = useState(false);
  const recipes = useQuery({ queryKey: ["milling", "settings", "recipes"], queryFn: () => fetchJson<{ rows: Recipe[] }>("/api/milling/settings/recipes"), enabled: open });
  const stock = useQuery({ queryKey: ["milling", "stock"], queryFn: () => fetchJson<{ products: StockProduct[] }>("/api/milling/stock"), enabled: open });
  const [values, setValues] = useState({ recipeId: "", bulk: "", outputLocationId: "", bagsPacked: "", damagedBags: "", bulkUsedKg: "", checkWeights: "" });
  const save = useMillPost({ done: "Pack run recorded", onDone: () => setOpen(false) });
  const recipe = recipes.data?.rows.find((row) => row.id === values.recipeId);
  const bulkOptions = (stock.data?.products ?? [])
    .filter((product) => product.name === recipe?.bulk)
    .flatMap((product) => product.lots.filter((lot) => lot.status === "AVAILABLE").flatMap((lot) => lot.balances.map((balance) => ({ value: `${lot.id}|${balance.stockLocationId}`, label: `${lot.code} at ${balance.location}: ${formatKg(balance.quantity)}` }))));
  const set = (key: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [key]: value }));
  const expected = recipe && values.bagsPacked ? Number(values.bagsPacked) * Number(recipe.kgPerBag) : null;
  const [bulkLotId, bulkLocationId] = values.bulk.split("|");
  return (
    <>
      <Button onClick={() => setOpen(true)}>Record a pack run</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a pack run</DialogTitle>
            <DialogDescription>Only released bulk lots can be packed. Empty bags and thread come off the oldest lots.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <MillSelect value={values.recipeId} onChange={(recipeId) => setValues((current) => ({ ...current, recipeId, bulk: "" }))} placeholder="What is packed" options={(recipes.data?.rows ?? []).filter((row) => row.isActive).map((row) => ({ value: row.id, label: row.packed }))} />
            <MillSelect value={values.bulk} onChange={set("bulk")} placeholder="From lot" options={bulkOptions} />
            <MillSelect value={values.outputLocationId} onChange={set("outputLocationId")} placeholder="Packed bags go to" options={(lookups.data?.locations ?? []).map((location) => ({ value: location.id, label: `${location.code} · ${location.name}` }))} />
            <div className="grid grid-cols-3 gap-3">
              <Field id="pk-bags" label="Bags packed">
                <Input id="pk-bags" className="font-mono" inputMode="numeric" value={values.bagsPacked} onChange={(event) => set("bagsPacked")(event.target.value)} />
              </Field>
              <Field id="pk-damaged" label="Damaged bags">
                <Input id="pk-damaged" className="font-mono" inputMode="numeric" value={values.damagedBags} onChange={(event) => set("damagedBags")(event.target.value)} />
              </Field>
              <Field id="pk-bulk" label="Bulk used kg" help={expected ? `Bags hold ${formatKg(expected)}` : undefined}>
                <Input id="pk-bulk" className="font-mono" inputMode="decimal" value={values.bulkUsedKg} onChange={(event) => set("bulkUsedKg")(event.target.value)} />
              </Field>
            </div>
            <Field id="pk-checks" label="Check weights (kg, comma separated)">
              <Input id="pk-checks" className="font-mono" value={values.checkWeights} onChange={(event) => set("checkWeights")(event.target.value)} placeholder="10.02, 9.98, 10.05" />
            </Field>
            <FormError error={save.error} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={save.pending}
              onClick={() =>
                save.post("/api/milling/packing", {
                  recipeId: values.recipeId,
                  bulkLotId,
                  bulkLocationId,
                  outputLocationId: values.outputLocationId,
                  bagsPacked: values.bagsPacked,
                  damagedBags: values.damagedBags || 0,
                  bulkUsedKg: values.bulkUsedKg,
                  checkWeights: values.checkWeights.split(",").map((part) => part.trim()).filter(Boolean),
                })
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
