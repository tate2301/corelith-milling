"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { formatQty, MillSelect, useMillLookups } from "@/components/milling/mill-ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson, getApiErrorMessage } from "@/lib/api-client";

type ProductStock = {
  id: string;
  name: string;
  unit: string;
  unitLabel: string | null;
  lots: Array<{ id: string; code: string; balances: Array<{ stockLocationId: string; quantity: number }> }>;
};

/**
 * Count one location. The ledger's figures are not shown, so the count is
 * what is there and not what the screen says; differences beyond the mill's
 * tolerance go to management before they post.
 */
export default function CountLocationPage() {
  const router = useRouter();
  const lookups = useMillLookups();
  const stock = useQuery({ queryKey: ["milling", "stock"], queryFn: () => fetchJson<{ products: ProductStock[] }>("/api/milling/stock") });
  const [locationId, setLocationId] = useState("");
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const lines = (stock.data?.products ?? []).flatMap((product) =>
    product.lots
      .filter((lot) => lot.balances.some((balance) => balance.stockLocationId === locationId))
      .map((lot) => ({ lotId: lot.id, code: lot.code, product })),
  );

  const save = useMutation({
    mutationFn: () =>
      fetchJson<{ status: string }>("/api/milling/stock/counts", {
        method: "POST",
        body: JSON.stringify({ stockLocationId: locationId, lines: lines.map((line) => ({ lotId: line.lotId, counted: counted[line.lotId] ?? "" })) }),
      }),
    onSuccess: () => router.push("/milling/stock?tab=counts"),
    onError: (failure) => setError(getApiErrorMessage(failure)),
  });

  if (lookups.isPending || stock.isPending) return <Skeleton className="m-4 h-64 max-w-lg" />;
  const complete = lines.length > 0 && lines.every((line) => (counted[line.lotId] ?? "").trim() !== "");

  return (
    <>
      <PageChrome title="Count a location" />
      <div className="max-w-lg space-y-4 px-4 py-4">
        <div className="space-y-1">
          <Label htmlFor="count-location">Location</Label>
          <MillSelect id="count-location" value={locationId} onChange={(value) => (setLocationId(value), setCounted({}))} options={(lookups.data?.locations ?? []).map((location) => ({ value: location.id, label: `${location.code} · ${location.name}` }))} />
        </div>
        {locationId && !lines.length ? <EmptyState title="No lots here" body="The ledger has nothing at this location." /> : null}
        {lines.map((line) => (
          <div key={line.lotId} className="grid grid-cols-[1fr_9rem] items-end gap-3">
            <div>
              <div className="font-mono text-sm">{line.code}</div>
              <div className="text-xs text-muted-foreground">
                {line.product.name} · in {formatQty(1, line.product.unit, line.product.unitLabel).replace(/^1\s?/, "") || "units"}
              </div>
            </div>
            <Input aria-label={`Counted for ${line.code}`} className="font-mono" inputMode="decimal" value={counted[line.lotId] ?? ""} onChange={(event) => setCounted((current) => ({ ...current, [line.lotId]: event.target.value }))} />
          </div>
        ))}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {lines.length ? (
          <Button disabled={!complete || save.isPending} onClick={() => (setError(null), save.mutate())}>
            {save.isPending ? "Saving…" : "Submit the count"}
          </Button>
        ) : null}
      </div>
    </>
  );
}
