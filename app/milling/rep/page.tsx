"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { PageChrome } from "@/components/layout/page-chrome";
import { CustomerState, money, type CustomerStateKey } from "@/components/milling/customer-bits";
import { MillSelect } from "@/components/milling/mill-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson } from "@/lib/api-client";

type Stop = { id: string; name: string; area: string | null; stop: number; owes: number; overdue: number; state: CustomerStateKey; visited: boolean };
type Day = { day: string; route: { id: string; code: string; name: string } | null; routes: Array<{ id: string; code: string; name: string }>; stops: Stop[]; next: Stop | null };

/**
 * A sales rep's route today (HM-C1), on a phone: the shops in order, what
 * each owes, ticked once visited, and the next one to visit pinned at the foot.
 */
export default function MillRepPage() {
  const params = useSearchParams();
  const routeId = params.get("route");
  const query = useQuery({ queryKey: ["milling", "rep", routeId], queryFn: () => fetchJson<Day>(`/api/milling/rep${routeId ? `?route=${routeId}` : ""}`), staleTime: 0, refetchOnMount: "always" });
  const day = query.data;
  const title = day?.route?.code ?? "Today's route";
  return (
    <>
      <PageChrome title={title} />
      <div className="mx-auto max-w-md space-y-3 px-4 pb-28 pt-2">
        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : !day?.route ? (
          <EmptyState title="No route today" body="You are not the rep on any running route. Ask dispatch to put you on one." />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {new Date(`${day.day.slice(0, 10)}T00:00:00`).toLocaleDateString("en-ZW", { weekday: "long", day: "numeric", month: "long" })}, {day.stops.length} {day.stops.length === 1 ? "stop" : "stops"}
            </p>
            {day.routes.length > 1 ? (
              <MillSelect
                value={day.route.id}
                onChange={(id) => window.location.assign(`/milling/rep?route=${id}`)}
                options={day.routes.map((route) => ({ value: route.id, label: `${route.code}, ${route.name}` }))}
              />
            ) : null}
            <ul className="divide-y divide-border">
              {day.stops.map((stop) => (
                <li key={stop.id}>
                  <Link href={`/milling/visits/new?customer=${stop.id}&back=/milling/rep${routeId ? `?route=${routeId}` : ""}`} className="flex items-center gap-3 py-3">
                    <span
                      aria-label={stop.visited ? "Visited" : "Not visited yet"}
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${stop.visited ? "border-transparent bg-[var(--status-success,#166534)] text-white" : "border-border"}`}
                    >
                      {stop.visited ? "✓" : ""}
                    </span>
                    <span className="flex-1">
                      <span className="block font-medium">{stop.name}</span>
                      <span className="block font-mono text-sm text-muted-foreground">
                        Owes {money(stop.owes)}
                        {stop.overdue ? `, ${money(stop.overdue)} overdue` : ""}
                      </span>
                    </span>
                    <CustomerState state={stop.state} />
                  </Link>
                </li>
              ))}
            </ul>
            {!day.stops.length ? <p className="text-sm text-muted-foreground">No shops are on this route yet.</p> : null}
          </>
        )}
      </div>
      {day?.next ? (
        <div className="fixed inset-x-0 bottom-14 border-t border-border bg-background p-3 md:static md:mx-auto md:max-w-md md:border-0">
          <Button className="h-12 w-full" asChild>
            <Link href={`/milling/visits/new?customer=${day.next.id}&back=/milling/rep${routeId ? `?route=${routeId}` : ""}`}>Visit {day.next.name}</Link>
          </Button>
        </div>
      ) : day?.route && day.stops.length ? (
        <p className="mx-auto max-w-md px-4 text-sm text-muted-foreground">Every shop on the route is visited.</p>
      ) : null}
    </>
  );
}
