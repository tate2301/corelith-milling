"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { PageChrome } from "@/components/layout/page-chrome";
import { money } from "@/components/milling/customer-bits";
import { type CommissionStatement, tripState } from "@/components/milling/commission-bits";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/api-client";

const day = (value: string) => new Date(value).toLocaleDateString("en-ZW", { weekday: "short", day: "numeric", month: "short" });

/** How a product line's commission was worked out, in words: "40 bags × $0.25" and/or "5% of $240.00". */
function workings(line: CommissionStatement["trips"][number]["products"][number]) {
  const parts = [];
  if (line.perBag) parts.push(`${line.bags} bags × ${money(line.perBag)}`);
  if (line.pct) parts.push(`${line.pct}% of ${money(line.soldFor)}`);
  return parts.join(" + ") || "No commission set";
}

/**
 * A seller's commission statement. Commission is paid on its own, never
 * through payroll and never taken off what the seller owes the mill. The page
 * reads top to bottom as earned − paid = due: every settled trip with how its
 * commission was worked out, then every payment and the trips it covered.
 * Payments cover the oldest commission first.
 */
export default function MillSellerCommissionPage() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({ queryKey: ["milling", "seller-commission", id], queryFn: () => fetchJson<CommissionStatement>(`/api/milling/sellers/${id}/commission`) });
  const statement = query.data;
  return (
    <>
      <PageChrome title={statement ? `Commission: ${statement.seller.name}` : "Commission"} />
      <div className="space-y-6 px-4 py-2">
        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : !statement ? (
          <EmptyState title="That seller is not here" body="Sellers are listed under Despatch, Sellers." />
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-xl font-semibold">{statement.seller.name}</h2>
                <p className="text-sm text-muted-foreground">
                  <span className="font-mono">{statement.seller.number}</span> · Commission is paid on its own, not through payroll, and is never taken off what they owe the mill.
                </p>
              </div>
              <Link href="/milling/sellers?tab=sellers" className="text-sm underline underline-offset-4">
                All sellers
              </Link>
            </div>

            <dl className="grid max-w-xl grid-cols-3 gap-4 border-y border-border py-3">
              <div>
                <dt className="text-sm text-muted-foreground">Earned</dt>
                <dd className="font-mono text-lg">{money(statement.totals.earned)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Paid</dt>
                <dd className="font-mono text-lg">− {money(statement.totals.paid)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Due</dt>
                <dd className={`font-mono text-lg ${statement.totals.due > 0 ? "font-semibold" : ""}`}>{money(statement.totals.due)}</dd>
              </div>
            </dl>

            <section className="space-y-2">
              <h3 className="font-medium">Earned on trips</h3>
              {!statement.trips.length ? (
                <p className="text-sm text-muted-foreground">No settled trip has earned commission yet. Commission is earned when a trip is settled.</p>
              ) : (
                <>
                  <ul className="divide-y divide-border md:hidden">
                    {statement.trips.map((trip) => (
                      <li key={trip.id} className="space-y-1 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <span>
                            <span className="font-mono">{trip.code}</span> <span className="text-sm text-muted-foreground">{day(trip.date)}</span>
                          </span>
                          <span className="font-mono">{money(trip.earned)}</span>
                        </div>
                        {trip.products.map((line) => (
                          <div key={line.product} className="text-sm text-muted-foreground">
                            {line.product}: <span className="font-mono">{workings(line)}</span>
                          </div>
                        ))}
                        <TripState trip={trip} />
                      </li>
                    ))}
                  </ul>
                  <div className="hidden md:block">
                    <Table hideControlsWhenSinglePage>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Trip</TableHead>
                          <TableHead>Sold</TableHead>
                          <TableHead className="text-right">Earned</TableHead>
                          <TableHead className="text-right">Paid</TableHead>
                          <TableHead className="text-right">Due</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {statement.trips.map((trip) => (
                          <TableRow key={trip.id}>
                            <TableCell className="align-top">
                              <span className="font-mono">{trip.code}</span> <span className="text-sm text-muted-foreground">{day(trip.date)}</span>
                            </TableCell>
                            <TableCell className="space-y-0.5 align-top text-sm">
                              {trip.products.map((line) => (
                                <div key={line.product}>
                                  {line.product}: <span className="font-mono text-muted-foreground">{workings(line)}</span> = <span className="font-mono">{money(line.earned)}</span>
                                </div>
                              ))}
                            </TableCell>
                            <TableCell className="text-right align-top font-mono">{money(trip.earned)}</TableCell>
                            <TableCell className="text-right align-top font-mono">{trip.paid ? money(trip.paid) : "—"}</TableCell>
                            <TableCell className="text-right align-top font-mono">{trip.due ? money(trip.due) : "—"}</TableCell>
                            <TableCell className="text-right align-top">
                              <TripState trip={trip} />
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-t-2 border-border font-medium">
                          <TableCell colSpan={2}>All trips</TableCell>
                          <TableCell className="text-right font-mono">{money(statement.totals.earned)}</TableCell>
                          <TableCell className="text-right font-mono">{money(statement.totals.paid)}</TableCell>
                          <TableCell className="text-right font-mono">{money(statement.totals.due)}</TableCell>
                          <TableCell />
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="font-medium">Payments</h3>
              {!statement.payments.length ? (
                <p className="text-sm text-muted-foreground">Nothing paid yet. Pay commission from the Sellers list; each payment is a paid bill to them in Books.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {statement.payments.map((payment) => (
                    <li key={payment.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                      <div className="space-y-0.5">
                        <div>
                          {day(payment.paidAt)}
                          {payment.billNumber ? <span className="text-sm text-muted-foreground"> · Books bill <span className="font-mono">{payment.billNumber}</span></span> : <span className="text-sm text-destructive"> · Not in Books</span>}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Covered {payment.covers.map((cover) => `${cover.code} (${money(cover.amount)})`).join(", ") || "no trip"}
                        </div>
                      </div>
                      <span className="font-mono">{money(payment.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

function TripState({ trip }: { trip: CommissionStatement["trips"][number] }) {
  const state = tripState(trip);
  return <StatusChip status={state === "PAID" ? "passing" : state === "PART" ? "in_progress" : "pending"} label={state === "PAID" ? "Paid" : state === "PART" ? `Part paid, ${money(trip.due)} due` : "Due"} />;
}
