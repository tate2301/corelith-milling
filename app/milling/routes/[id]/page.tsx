"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { FormError } from "@/components/milling/form-bits";
import { MillSelect } from "@/components/milling/mill-ui";
import { RouteForm, type RouteFormVehicle } from "@/components/milling/route-form";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { useMillPost } from "@/components/milling/use-mill-post";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/api-client";

type Stop = { id: string; name: string; area: string | null; stop: number };
type Trip = { id: string; code: string; date: string; km: number | null; litres: number | null; kmPerLitre: number | null; status: string };
type Route = { id: string; code: string; name: string; isActive: boolean; visitDays: number[]; visitDaysLabel: string; vehicleId: string | null; vehicle: string | null; stops: Stop[]; trips: Trip[] };
type Lookups = { vehicles: RouteFormVehicle[]; customers: Array<{ id: string; name: string; area: string | null; routeId: string | null }> };

const day = (value: string) => new Date(value).toLocaleDateString("en-ZW", { weekday: "short", day: "numeric", month: "short" });

/** A route and its stops (DS-B3): the customers in order, its last trips, and a trip planned from it. */
export default function MillRoutePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const access = useMillAccess();
  const query = useQuery({ queryKey: ["milling", "route", id], queryFn: () => fetchJson<Route>(`/api/milling/routes/${id}`) });
  const lookups = useQuery({ queryKey: ["milling", "routes"], queryFn: () => fetchJson<Lookups>("/api/milling/routes") });
  const plan = useMillPost<{ id: string }>({ done: "Trip planned; load its orders", onDone: (trip) => router.push(`/milling/deliveries/${trip.id}`) });
  const route = query.data;
  const last = route?.trips.find((trip) => trip.kmPerLitre !== null);
  const manage = access.can("delivery.manage");
  return (
    <>
      <PageChrome title={route?.code ?? "Route"} />
      <div className="space-y-5 px-4 py-2">
        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : !route ? (
          <EmptyState title="That route is not here" body="It may have been removed. Routes are listed under Despatch." />
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{route.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {route.isActive ? route.visitDaysLabel : "Not running"} · <span className="font-mono">{route.vehicle ?? "no usual vehicle"}</span> · {route.stops.length} stops
                </p>
              </div>
              <div className="flex gap-2">
                {manage ? <RouteForm vehicles={lookups.data?.vehicles ?? []} route={route} label="Edit route" /> : null}
                {manage && route.isActive ? (
                  <Button disabled={plan.pending || !route.vehicleId} onClick={() => plan.post(`/api/milling/routes/${route.id}/trip`, {})}>
                    Plan a trip
                  </Button>
                ) : null}
              </div>
            </div>
            <FormError error={plan.error} />
            <dl className="grid grid-cols-2 divide-border rounded-md border border-border sm:grid-cols-4 sm:divide-x">
              <Fact label="Stops" mono>
                {route.stops.length}
              </Fact>
              <Fact label="Visit days">{route.visitDaysLabel}</Fact>
              <Fact label="Usual vehicle" mono>
                {route.vehicle ?? "—"}
              </Fact>
              <Fact label="Last trip" mono>
                {last ? `${last.km} km, ${last.kmPerLitre} km a litre` : "—"}
              </Fact>
            </dl>

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Stops in order</h3>
                {manage ? <EditStops route={route} customers={lookups.data?.customers ?? []} /> : null}
              </div>
              {!route.stops.length ? (
                <p className="text-sm text-muted-foreground">No customers on this route yet.</p>
              ) : (
                <Table hideControlsWhenSinglePage>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Stop</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Area</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {route.stops.map((stop) => (
                      <TableRow key={stop.id}>
                        <TableCell className="font-mono">{stop.stop}</TableCell>
                        <TableCell>{stop.name}</TableCell>
                        <TableCell>{stop.area ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="font-medium">Last trips</h3>
              {!route.trips.length ? (
                <p className="text-sm text-muted-foreground">No trip has run this route yet.</p>
              ) : (
                <Table hideControlsWhenSinglePage>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Trip</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Kilometres</TableHead>
                      <TableHead className="text-right">Km a litre</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {route.trips.map((trip) => (
                      <TableRow key={trip.id}>
                        <TableCell className="font-mono">
                          <Link className="underline" href={`/milling/deliveries/${trip.id}`}>
                            {trip.code}
                          </Link>
                        </TableCell>
                        <TableCell>{day(trip.date)}</TableCell>
                        <TableCell className="text-right font-mono">{trip.km ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono">{trip.kmPerLitre ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

function Fact({ label, mono, children }: { label: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <div className="p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono" : undefined}>{children}</dd>
    </div>
  );
}

/** Put customers on the route and in order: move up, move down, take off, add. */
function EditStops({ route, customers }: { route: Route; customers: Lookups["customers"] }) {
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState<string[]>(route.stops.map((stop) => stop.id));
  const [adding, setAdding] = useState("");
  const save = useMillPost({ done: "Stops saved", onDone: () => setOpen(false) });
  const name = (id: string) => customers.find((row) => row.id === id)?.name ?? route.stops.find((row) => row.id === id)?.name ?? "";
  const move = (index: number, by: number) =>
    setOrder((current) => {
      const next = [...current];
      const [row] = next.splice(index, 1);
      next.splice(index + by, 0, row!);
      return next;
    });
  // A customer on another route moves to this one when saved.
  const candidates = customers.filter((row) => !order.includes(row.id));
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => (setOrder(route.stops.map((stop) => stop.id)), setOpen(true))}>
        Edit stops
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stops on {route.code}</DialogTitle>
            <DialogDescription className="not-sr-only t-body-sm text-[var(--text-muted)]">First stop at the top. A customer on another route moves to this one.</DialogDescription>
          </DialogHeader>
          <ol className="divide-y divide-border rounded-md border border-border">
            {order.map((id, index) => (
              <li key={id} className="flex items-center justify-between gap-2 p-2 text-sm">
                <span>
                  <span className="mr-2 font-mono text-muted-foreground">{index + 1}</span>
                  {name(id)}
                </span>
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" disabled={index === 0} aria-label={`Move ${name(id)} up`} onClick={() => move(index, -1)}>
                    Up
                  </Button>
                  <Button size="sm" variant="ghost" disabled={index === order.length - 1} aria-label={`Move ${name(id)} down`} onClick={() => move(index, 1)}>
                    Down
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setOrder((current) => current.filter((row) => row !== id))}>
                    Take off
                  </Button>
                </span>
              </li>
            ))}
            {!order.length ? <li className="p-2 text-sm text-muted-foreground">No stops.</li> : null}
          </ol>
          <div className="flex gap-2">
            <div className="flex-1">
              <MillSelect value={adding} onChange={setAdding} placeholder="Add a customer" options={candidates.map((row) => ({ value: row.id, label: row.area ? `${row.name}, ${row.area}` : row.name }))} />
            </div>
            <Button variant="secondary" disabled={!adding} onClick={() => (setOrder((current) => [...current, adding]), setAdding(""))}>
              Add
            </Button>
          </div>
          <FormError error={save.error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={save.pending} onClick={() => save.post(`/api/milling/routes/${route.id}/stops`, { customerIds: order })}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
