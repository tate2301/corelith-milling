"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { CustomerState, money } from "@/components/milling/customer-bits";
import { PromiseDialog } from "@/components/milling/promise-dialog";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SectionTab, SectionTabs } from "@/components/ui/section-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/api-client";

type Row = {
  id: string;
  name: string;
  route: string | null;
  creditLimit: number | null;
  owes: number;
  overdue: number;
  state: "OVER_LIMIT" | "OVERDUE" | "CURRENT";
  promise: { amount: number; promisedFor: string; passed: boolean } | null;
};
type View = { rows: Row[]; counts: { ALL: number; OVERDUE: number; OVER_LIMIT: number }; totals: { creditLimit: number; owes: number; overdue: number } };

const TABS = [
  { key: "ALL", label: "All" },
  { key: "OVERDUE", label: "Overdue" },
  { key: "OVER_LIMIT", label: "Over limit" },
] as const;

/** Collections (CU-A1): who owes the mill, what is overdue against their limit, and promises to pay. */
export default function MillCollectionsPage() {
  const params = useSearchParams();
  const tab = (params.get("tab") ?? "ALL") as (typeof TABS)[number]["key"];
  const access = useMillAccess();
  const [chosen, setChosen] = useState<string[]>([]);
  const [promising, setPromising] = useState<Row | null>(null);
  const query = useQuery({ queryKey: ["milling", "collections"], queryFn: () => fetchJson<View>("/api/milling/customers/collections") });
  const rows = (query.data?.rows ?? []).filter((row) => (tab === "OVERDUE" ? row.overdue > 0 : tab === "OVER_LIMIT" ? row.state === "OVER_LIMIT" : true));
  const picked = rows.filter((row) => chosen.includes(row.id));
  const owedPicked = picked.reduce((sum, row) => sum + row.owes, 0);
  const canRecord = access.can("collection.record");
  return (
    <>
      <PageChrome title="Collections" />
      <div className="space-y-4 px-4 py-2">
        <SectionTabs label="Collections">
          {TABS.map((entry) => (
            <SectionTab key={entry.key} to={entry.key === "ALL" ? "/milling/collections" : `/milling/collections?tab=${entry.key}`} active={tab === entry.key} count={query.data?.counts[entry.key]}>
              {entry.label}
            </SectionTab>
          ))}
        </SectionTabs>
        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : query.isError ? (
          <EmptyState title="Collections did not load" body="Check the connection and try again." />
        ) : !rows.length ? (
          <EmptyState title={tab === "ALL" ? "Nobody owes the mill" : "Nobody here"} body="What customers owe comes from their issued invoices in Books." />
        ) : (
          <>
            <ul className="divide-y divide-border rounded-md border border-border md:hidden">
              {rows.map((row) => (
                <li key={row.id} className="space-y-1 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link className="font-medium underline" href={`/milling/collections/${row.id}`}>
                      {row.name}
                    </Link>
                    <CustomerState state={row.state} />
                  </div>
                  <div className="font-mono text-sm text-muted-foreground">
                    Owes {money(row.owes)}
                    {row.overdue ? `, ${money(row.overdue)} overdue` : ""}
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table hideControlsWhenSinglePage>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Customer</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead className="text-right">Credit limit</TableHead>
                    <TableHead className="text-right">Owes</TableHead>
                    <TableHead className="text-right">Overdue</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Promise</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id} data-state={chosen.includes(row.id) ? "selected" : undefined}>
                      <TableCell>
                        <Checkbox aria-label={`Choose ${row.name}`} checked={chosen.includes(row.id)} onCheckedChange={(on) => setChosen((current) => (on === true ? [...current, row.id] : current.filter((id) => id !== row.id)))} />
                      </TableCell>
                      <TableCell>
                        <Link className="underline" href={`/milling/collections/${row.id}`}>
                          {row.name}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono">{row.route ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">{money(row.creditLimit)}</TableCell>
                      <TableCell className="text-right font-mono">{money(row.owes)}</TableCell>
                      <TableCell className="text-right font-mono">{row.overdue ? money(row.overdue) : "—"}</TableCell>
                      <TableCell>
                        <CustomerState state={row.state} />
                      </TableCell>
                      <TableCell className={`text-sm ${row.promise?.passed ? "text-destructive" : ""}`}>
                        {row.promise ? `${money(row.promise.amount)} by ${new Date(row.promise.promisedFor).toLocaleDateString("en-ZW", { day: "numeric", month: "short" })}${row.promise.passed ? ", passed" : ""}` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 border-border font-medium">
                    <TableCell />
                    <TableCell colSpan={2}>
                      {rows.length} {rows.length === 1 ? "customer" : "customers"}
                    </TableCell>
                    <TableCell className="text-right font-mono">{money(rows.reduce((sum, row) => sum + (row.creditLimit ?? 0), 0))}</TableCell>
                    <TableCell className="text-right font-mono">{money(rows.reduce((sum, row) => sum + row.owes, 0))}</TableCell>
                    <TableCell className="text-right font-mono">{money(rows.reduce((sum, row) => sum + row.overdue, 0))}</TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            {picked.length ? (
              <div className="sticky bottom-2 flex flex-wrap items-center gap-3 rounded-md border border-border bg-background p-3 shadow-sm">
                <span className="text-sm">
                  <span className="font-medium">{picked.length}</span> selected · <span className="font-mono">{money(owedPicked)}</span> owed
                </span>
                {picked.length === 1 ? (
                  <Button size="sm" variant="secondary" asChild>
                    <Link href={`/books/customers/${picked[0]!.id}`}>Statement in Books</Link>
                  </Button>
                ) : null}
                {picked.length === 1 && canRecord ? (
                  <Button size="sm" onClick={() => setPromising(picked[0]!)}>
                    Record a promise
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setChosen([])}>
                  Clear
                </Button>
              </div>
            ) : null}
          </>
        )}
        {promising ? <PromiseDialog customerId={promising.id} name={promising.name} owes={promising.owes} onClose={() => (setPromising(null), setChosen([]))} /> : null}
      </div>
    </>
  );
}
