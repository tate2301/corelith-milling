"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { CustomerState, money, type CustomerStateKey } from "@/components/milling/customer-bits";
import { Field, FormError } from "@/components/milling/form-bits";
import { PromiseDialog } from "@/components/milling/promise-dialog";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { useMillPost } from "@/components/milling/use-mill-post";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/api-client";

type Account = {
  id: string;
  name: string;
  phone: string | null;
  route: { id: string; code: string } | null;
  creditLimit: number | null;
  termsDays: number;
  owes: number;
  overdue: number;
  state: CustomerStateKey;
  invoices: Array<{ id: string; number: string | null; due: string | null; open: number; daysLate: number }>;
  promises: Array<{ id: string; amount: number; promisedFor: string; note: string | null; createdAt: string }>;
  visits: Array<{ id: string; visitedAt: string; competitorPrice: number | null; shelfSharePct: number | null }>;
};

const day = (value: string | null) => (value ? new Date(value).toLocaleDateString("en-ZW", { day: "numeric", month: "short" }) : "—");

/** A customer's account (CU-A2): what they owe invoice by invoice, against their limit, with promises and visits. */
export default function MillCustomerAccountPage() {
  const { id } = useParams<{ id: string }>();
  const access = useMillAccess();
  const [promising, setPromising] = useState(false);
  const query = useQuery({ queryKey: ["milling", "customer", id], queryFn: () => fetchJson<Account>(`/api/milling/customers/${id}`) });
  const account = query.data;
  const overBy = account && account.creditLimit !== null ? account.owes - account.creditLimit : 0;
  return (
    <>
      <PageChrome title={account?.name ?? "Customer"} />
      <div className="space-y-5 px-4 py-2">
        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : !account ? (
          <EmptyState title="That customer is not here" body="Customers are listed under Collections." />
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-xl font-semibold">{account.name}</h2>
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <CustomerState state={account.state} />
                  {account.route ? (
                    <Link className="font-mono underline" href={`/milling/routes/${account.route.id}`}>
                      {account.route.code}
                    </Link>
                  ) : null}
                  <span>{account.termsDays} days</span>
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-2xl">{money(account.owes)}</div>
                <div className="text-sm text-muted-foreground">
                  owed, {account.invoices.length} {account.invoices.length === 1 ? "invoice" : "invoices"}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" asChild>
                <Link href={`/books/customers/${account.id}`}>Statement in Books</Link>
              </Button>
              {access.can("exception.decide") ? <TermsDialog account={account} /> : null}
              {access.can("collection.record") && account.owes > 0 ? <Button onClick={() => setPromising(true)}>Record a promise</Button> : null}
            </div>
            {overBy > 0 ? (
              <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">
                <span className="font-medium">Over the limit by {money(overBy)}.</span> {money(account.owes)} owed against {money(account.creditLimit)}.
              </div>
            ) : null}
            <dl className="grid grid-cols-2 divide-border rounded-md border border-border sm:grid-cols-4 sm:divide-x">
              <Fact label="Credit limit">{money(account.creditLimit)}</Fact>
              <Fact label="Overdue">{money(account.overdue)}</Fact>
              <Fact label="Terms">{account.termsDays} days</Fact>
              <Fact label="Last promise">{account.promises[0] ? `${money(account.promises[0].amount)} by ${day(account.promises[0].promisedFor)}` : "—"}</Fact>
            </dl>
            <section className="space-y-2">
              <h3 className="font-medium">Unpaid invoices</h3>
              {!account.invoices.length ? (
                <p className="text-sm text-muted-foreground">Nothing is owed.</p>
              ) : (
                <Table hideControlsWhenSinglePage>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead className="text-right">Due</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead className="text-right">Open</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {account.invoices.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-mono">
                          <Link className="underline" href={`/books/invoices/${invoice.id}`}>
                            {invoice.number ?? "Draft"}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right font-mono">{day(invoice.due)}</TableCell>
                        <TableCell>
                          <CustomerState state={invoice.daysLate > 0 ? "OVERDUE" : "CURRENT"} />
                        </TableCell>
                        <TableCell className="text-right font-mono">{money(invoice.open)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 border-border font-medium">
                      <TableCell colSpan={3}>Owed</TableCell>
                      <TableCell className="text-right font-mono">{money(account.owes)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </section>
            {account.visits.length ? (
              <section className="space-y-2">
                <h3 className="font-medium">Last visits</h3>
                <ul className="divide-y divide-border rounded-md border border-border text-sm">
                  {account.visits.map((visit) => (
                    <li key={visit.id} className="flex justify-between p-2">
                      <span>{new Date(visit.visitedAt).toLocaleString("en-ZW", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      <span className="font-mono">
                        {visit.competitorPrice !== null ? `competitor ${money(visit.competitorPrice)}` : ""}
                        {visit.shelfSharePct !== null ? ` · ${visit.shelfSharePct}% of the shelf` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {promising ? <PromiseDialog customerId={account.id} name={account.name} owes={account.owes} onClose={() => setPromising(false)} /> : null}
          </>
        )}
      </div>
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono">{children}</dd>
    </div>
  );
}

function TermsDialog({ account }: { account: Account }) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(account.creditLimit === null ? "" : String(account.creditLimit));
  const [days, setDays] = useState(String(account.termsDays));
  const save = useMillPost({ done: "Terms saved", onDone: () => setOpen(false) });
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Limit and terms
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Limit and terms for {account.name}</DialogTitle>
            <DialogDescription className="not-sr-only t-body-sm text-[var(--text-muted)]">What they may owe the mill, and how many days they have to pay. Leave the limit empty for none.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field id="tm-limit" label="Credit limit, $">
              <Input id="tm-limit" inputMode="decimal" className="font-mono" value={limit} onChange={(event) => setLimit(event.target.value)} />
            </Field>
            <Field id="tm-days" label="Days to pay">
              <Input id="tm-days" inputMode="numeric" className="font-mono" value={days} onChange={(event) => setDays(event.target.value)} />
            </Field>
          </div>
          <FormError error={save.error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={save.pending} onClick={() => save.post(`/api/milling/customers/${account.id}/terms`, { creditLimit: limit === "" ? null : Number(limit), termsDays: Number(days) })}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
