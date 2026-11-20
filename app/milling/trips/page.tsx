"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { PageChrome } from "@/components/layout/page-chrome";
import { MillStatus } from "@/components/milling/mill-ui";
import { SectionTab, SectionTabs } from "@/components/ui/section-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/api-client";

type Trip = {
  id: string;
  code: string;
  status: string;
  route: { id: string; code: string; name: string } | null;
  vehicle: string | null;
  driver: string | null;
  date: string;
  stops: number;
  delivered: number;
  km: number | null;
  litres: number | null;
  kmPerLitre: number | null;
};
type Trips = { counts: { ALL: number; OUT: number; CLOSED: number }; trips: Trip[]; totals: { trips: number; km: number; litres: number; kmPerLitre: number | null } };

const TABS = [
  { key: "ALL", label: "All", query: "" },
  { key: "OUT", label: "Out", query: "?status=OUT" },
  { key: "CLOSED", label: "Closed", query: "?status=CLOSED" },
] as const;

const day = (value: string) => new Date(value).toLocaleDateString("en-ZW", { weekday: "short", day: "numeric", month: "short" });
const num = (value: number | null, digits = 0) => (value === null ? "—" : value.toLocaleString("en-ZW", { maximumFractionDigits: digits, minimumFractionDigits: digits }));

/** Trips (DS-B1): each vehicle run once it has left, with what it delivered and its fuel. A trip opens as its delivery. */
export default function MillTripsPage() {
  const params = useSearchParams();
  const status = params.get("status");
  const tab = status === "OUT" || status === "CLOSED" ? status : "ALL";
  const query = useQuery({ queryKey: ["milling", "trips", tab], queryFn: () => fetchJson<Trips>(`/api/milling/trips${tab === "ALL" ? "" : `?status=${tab}`}`) });
  const data = query.data;
  return (
    <>
      <PageChrome title="Trips" />
      <div className="space-y-4 px-4 py-2">
        <SectionTabs label="Trips by state">
          {TABS.map((entry) => (
            <SectionTab key={entry.key} to={`/milling/trips${entry.query}`} active={tab === entry.key} count={data?.counts[entry.key] ?? undefined}>
              {entry.label}
            </SectionTab>
          ))}
        </SectionTabs>
        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : query.isError || !data ? (
          <EmptyState title="Trips did not load" body="Check the connection and try again." />
        ) : !data.trips.length ? (
          <EmptyState title={tab === "OUT" ? "No vehicle is out" : "No trips yet"} body="A delivery becomes a trip when its vehicle leaves. Plan one from Despatches or a route." />
        ) : (
          <>
            <ul className="divide-y divide-border rounded-md border border-border md:hidden">
              {data.trips.map((trip) => (
                <li key={trip.id} className="space-y-1 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link className="font-mono underline" href={`/milling/deliveries/${trip.id}`}>
                      {trip.code}
                    </Link>
                    <span className="text-sm">{trip.vehicle ?? "—"}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-mono">
                      {trip.delivered} of {trip.stops} · {num(trip.km)} km · {num(trip.kmPerLitre, 2)} km/L
                    </span>
                    <MillStatus status={trip.status} />
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table hideControlsWhenSinglePage>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trip</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Driver</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead className="text-right">Date</TableHead>
                    <TableHead className="text-right">Delivered</TableHead>
                    <TableHead className="text-right">Kilometres</TableHead>
                    <TableHead className="text-right">Litres</TableHead>
                    <TableHead className="text-right">Km a litre</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.trips.map((trip) => (
                    <TableRow key={trip.id}>
                      <TableCell className="font-mono">
                        <Link className="underline" href={`/milling/deliveries/${trip.id}`}>
                          {trip.code}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono">
                        {trip.route ? (
                          <Link className="underline" href={`/milling/routes/${trip.route.id}`}>
                            {trip.route.code}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="font-mono">{trip.vehicle ?? "—"}</TableCell>
                      <TableCell>{trip.driver ?? "—"}</TableCell>
                      <TableCell>
                        <MillStatus status={trip.status} />
                      </TableCell>
                      <TableCell className="text-right font-mono">{day(trip.date)}</TableCell>
                      <TableCell className="text-right font-mono">
                        {trip.delivered} of {trip.stops}
                      </TableCell>
                      <TableCell className="text-right font-mono">{num(trip.km)}</TableCell>
                      <TableCell className="text-right font-mono">{num(trip.litres)}</TableCell>
                      <TableCell className="text-right font-mono">{num(trip.kmPerLitre, 2)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 border-border font-medium">
                    <TableCell colSpan={7}>
                      {data.totals.trips} {data.totals.trips === 1 ? "trip" : "trips"}
                    </TableCell>
                    <TableCell className="text-right font-mono">{num(data.totals.km)}</TableCell>
                    <TableCell className="text-right font-mono">{num(data.totals.litres)}</TableCell>
                    <TableCell className="text-right font-mono">{num(data.totals.kmPerLitre, 2)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
