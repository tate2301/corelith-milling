"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import { useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { money } from "@/components/milling/customer-bits";
import { Field } from "@/components/milling/form-bits";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/api-client";

type Row = { routeId: string | null; route: string; visits: number; shops: number; competitorPrice: number | null; shelfSharePct: number | null; ourBagsOnShelf: number };

const firstOfMonth = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
};
const firstOfNext = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
};

/** Surveys: the market survey by route (R9), from the reps' visits over the days chosen. */
export default function MillSurveysPage() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(firstOfNext());
  const query = useQuery({ queryKey: ["milling", "surveys", from, to], queryFn: () => fetchJson<{ rows: Row[] }>(`/api/milling/customers/surveys?from=${from}&to=${to}`) });
  const rows = query.data?.rows ?? [];
  return (
    <>
      <PageChrome title="Surveys" />
      <div className="space-y-4 px-4 py-2">
        <div className="flex flex-wrap gap-3">
          <Field id="sv-from" label="From">
            <Input id="sv-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field id="sv-to" label="Up to">
            <Input id="sv-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </Field>
        </div>
        {query.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : query.isError ? (
          <EmptyState title="The survey did not load" body="Check the connection and try again." />
        ) : !rows.length ? (
          <EmptyState title="No visits in these days" body="The survey is built from the reps' shop visits." />
        ) : (
          <Table hideControlsWhenSinglePage>
            <TableHeader>
              <TableRow>
                <TableHead>Route</TableHead>
                <TableHead className="text-right">Visits</TableHead>
                <TableHead className="text-right">Shops</TableHead>
                <TableHead className="text-right">Competitor price</TableHead>
                <TableHead className="text-right">Our shelf share</TableHead>
                <TableHead className="text-right">Our bags seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.routeId ?? "none"}>
                  <TableCell>{row.route}</TableCell>
                  <TableCell className="text-right font-mono">{row.visits}</TableCell>
                  <TableCell className="text-right font-mono">{row.shops}</TableCell>
                  <TableCell className="text-right font-mono">{row.competitorPrice !== null ? money(row.competitorPrice) : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{row.shelfSharePct !== null ? `${row.shelfSharePct}%` : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{row.ourBagsOnShelf}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
