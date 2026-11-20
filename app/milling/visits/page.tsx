"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import Link from "next/link";

import { PageChrome } from "@/components/layout/page-chrome";
import { money } from "@/components/milling/customer-bits";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/api-client";

type Visit = { id: string; visitedAt: string; customerId: string; customer: string; route: string | null; rep: string | null; competitorPrice: number | null; ourBagsOnShelf: number | null; shelfSharePct: number | null; photoUrl: string | null; note: string | null };

const when = (value: string) => new Date(value).toLocaleString("en-ZW", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Visits: each shop a rep called on, and what they saw there. A rep sees their own. */
export default function MillVisitsPage() {
  const access = useMillAccess();
  const query = useQuery({ queryKey: ["milling", "visits"], queryFn: () => fetchJson<{ rows: Visit[] }>("/api/milling/customers/visits") });
  const rows = query.data?.rows ?? [];
  return (
    <>
      <PageChrome title="Visits" />
      <div className="space-y-4 px-4 py-2">
        <div className="flex justify-end gap-2">
          <Button variant="secondary" asChild>
            <Link href="/milling/surveys">Survey by route</Link>
          </Button>
          {access.can("visit.record") ? (
            <Button asChild>
              <Link href="/milling/visits/new">Record a visit</Link>
            </Button>
          ) : null}
        </div>
        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : query.isError ? (
          <EmptyState title="Visits did not load" body="Check the connection and try again." />
        ) : !rows.length ? (
          <EmptyState title="No visits yet" body="A rep records a visit from their route on a phone." />
        ) : (
          <>
            <ul className="divide-y divide-border rounded-md border border-border md:hidden">
              {rows.map((row) => (
                <li key={row.id} className="space-y-1 p-3">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{row.customer}</span>
                    <span className="text-sm text-muted-foreground">{when(row.visitedAt)}</span>
                  </div>
                  <div className="font-mono text-sm text-muted-foreground">
                    {row.competitorPrice !== null ? `competitor ${money(row.competitorPrice)}` : "no price"} · {row.ourBagsOnShelf ?? "—"} bags · {row.shelfSharePct ?? "—"}%
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table hideControlsWhenSinglePage>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Shop</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>Rep</TableHead>
                    <TableHead className="text-right">Competitor price</TableHead>
                    <TableHead className="text-right">Our bags</TableHead>
                    <TableHead className="text-right">Shelf share</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap font-mono">{when(row.visitedAt)}</TableCell>
                      <TableCell>
                        <Link className="underline" href={`/milling/collections/${row.customerId}`}>
                          {row.customer}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono">{row.route ?? "—"}</TableCell>
                      <TableCell>{row.rep ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">{row.competitorPrice !== null ? money(row.competitorPrice) : "—"}</TableCell>
                      <TableCell className="text-right font-mono">{row.ourBagsOnShelf ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">{row.shelfSharePct !== null ? `${row.shelfSharePct}%` : "—"}</TableCell>
                      <TableCell className="text-sm">
                        {row.note ?? ""}
                        {row.photoUrl ? (
                          <>
                            {row.note ? " · " : ""}
                            <a className="underline" href={row.photoUrl} target="_blank" rel="noreferrer">
                              Photo
                            </a>
                          </>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
