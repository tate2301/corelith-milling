"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { PageChrome } from "@/components/layout/page-chrome";
import { RouteForm, type RouteFormVehicle } from "@/components/milling/route-form";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/api-client";

type RouteRow = { id: string; code: string; name: string; isActive: boolean; areas: string; stops: number; visitDays: number[]; visitDaysLabel: string; vehicleId: string | null; vehicle: string | null; km: number | null };

/** Routes (DS-B2): customers visited in order on set days, and the vehicle that usually runs them. */
export default function MillRoutesPage() {
  const router = useRouter();
  const access = useMillAccess();
  const query = useQuery({ queryKey: ["milling", "routes"], queryFn: () => fetchJson<{ routes: RouteRow[]; vehicles: RouteFormVehicle[] }>("/api/milling/routes") });
  const routes = query.data?.routes ?? [];
  return (
    <>
      <PageChrome title="Routes" />
      <div className="space-y-4 px-4 py-2">
        <div className="flex justify-end">
          {access.can("delivery.manage") ? <RouteForm vehicles={query.data?.vehicles ?? []} label="New route" onSaved={(id) => router.push(`/milling/routes/${id}`)} /> : null}
        </div>
        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : query.isError ? (
          <EmptyState title="Routes did not load" body="Check the connection and try again." />
        ) : !routes.length ? (
          <EmptyState title="No routes yet" body="A route is the customers a vehicle visits, in order, on set days." />
        ) : (
          <>
            <ul className="divide-y divide-border rounded-md border border-border md:hidden">
              {routes.map((route) => (
                <li key={route.id} className="space-y-1 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link className="font-mono underline" href={`/milling/routes/${route.id}`}>
                      {route.code}
                    </Link>
                    <span>{route.areas}</span>
                  </div>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>
                      {route.stops} stops · {route.visitDaysLabel}
                    </span>
                    <span className="font-mono">{route.vehicle ?? "No vehicle"}</span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table hideControlsWhenSinglePage>
                <TableHeader>
                  <TableRow>
                    <TableHead>Route</TableHead>
                    <TableHead>Areas</TableHead>
                    <TableHead className="text-right">Stops</TableHead>
                    <TableHead>Visit days</TableHead>
                    <TableHead>Usual vehicle</TableHead>
                    <TableHead className="text-right">Kilometres</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {routes.map((route) => (
                    <TableRow key={route.id} className={route.isActive ? "" : "text-muted-foreground"}>
                      <TableCell className="font-mono">
                        <Link className="underline" href={`/milling/routes/${route.id}`}>
                          {route.code}
                        </Link>
                      </TableCell>
                      <TableCell>{route.areas}</TableCell>
                      <TableCell className="text-right font-mono">{route.stops}</TableCell>
                      <TableCell>{route.isActive ? route.visitDaysLabel : "Not running"}</TableCell>
                      <TableCell className="font-mono">{route.vehicle ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">{route.km ?? "—"}</TableCell>
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
