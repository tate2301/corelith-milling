"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { DashboardFrame, DashSkeleton } from "@/components/dashboard-frame/dashboard-frame";
import { Panel } from "@/components/dashboard-frame/panel";
import { StatusList } from "@/components/dashboard-frame/status-list";
import { PageChrome } from "@/components/layout/page-chrome";
import { money, type CustomerStateKey } from "@/components/milling/customer-bits";
import { LoadError } from "@/components/list-frame/list-states";
import { Button } from "@/components/workspace/button";
import { FilterChip } from "@/components/workspace/filter-chip";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/workspace/menu";
import type { StateTone } from "@/components/workspace/state-badge";
import { fetchJson, getApiErrorMessage } from "@/lib/api-client";

type Stop = { id: string; name: string; area: string | null; stop: number; owes: number; overdue: number; state: CustomerStateKey; visited: boolean };
type Day = { day: string; route: { id: string; code: string; name: string } | null; routes: Array<{ id: string; code: string; name: string }>; stops: Stop[]; next: Stop | null };

const ZONE = "Africa/Harare";
const STATE: Record<CustomerStateKey, { tone: StateTone; label: string }> = {
  CURRENT: { tone: "hollow", label: "Current" },
  OVERDUE: { tone: "warn", label: "Overdue" },
  OVER_LIMIT: { tone: "bad", label: "Over limit" },
};

/**
 * A sales rep's route today (HM-C1), on core's DashboardFrame: the shops in
 * order with what each owes, those visited marked, and the next one to visit
 * pinned at the foot. Each shop opens its visit.
 */
export default function MillRepPage() {
  const params = useSearchParams();
  const router = useRouter();
  const routeId = params.get("route");
  const query = useQuery({ queryKey: ["milling", "rep", routeId], queryFn: () => fetchJson<Day>(`/api/milling/rep${routeId ? `?route=${routeId}` : ""}`), staleTime: 0, refetchOnMount: "always" });
  const day = query.data;
  const back = `/milling/rep${routeId ? `?route=${routeId}` : ""}`;
  const visitHref = (stop: Stop) => `${back}${back.includes("?") ? "&" : "?"}sheet=mill-visit-new&customer=${stop.id}`;
  const visited = day?.stops.filter((stop) => stop.visited).length ?? 0;

  const toolbar = (
    <div role="toolbar" aria-label="Route" className="cx-df-toolbar cx-df-toolbar--wrap">
      {day?.route && day.routes.length > 1 ? (
        <Menu>
          <MenuTrigger asChild>
            <FilterChip label="Route" value={day.route.code} isSet />
          </MenuTrigger>
          <MenuContent>
            <MenuRadioGroup value={day.route.id} onValueChange={(id) => router.replace(`/milling/rep?route=${id}`)}>
              {day.routes.map((route) => (
                <MenuRadioItem key={route.id} value={route.id}>
                  {route.code} · {route.name}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
      ) : null}
      <span className="cx-df-toolbar__quiet">
        {day ? new Date(`${day.day.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: ZONE, weekday: "long", day: "numeric", month: "long" }) : "Today"}
      </span>
    </div>
  );

  return (
    <>
      <PageChrome title={day?.route?.code ?? "Today's route"} primary={{ label: "Sell", icon: "plus", sheet: "mill-sell" }} />
      {query.isError ? (
        <LoadError noun="route" message={getApiErrorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DashboardFrame variant="overview" label="Today's route" toolbar={toolbar}>
          {!day ? (
            <div className="cx-df-span-12">
              <DashSkeleton height={320} />
            </div>
          ) : !day.route ? (
            <Panel span={12} title="Today's route" empty="You are not the rep on any running route. Ask dispatch to put you on one." />
          ) : (
            <Panel
              span={12}
              title={day.route.name}
              count={{ value: `${visited}/${day.stops.length}` }}
              qualifier="visited"
              link={{ href: `/milling/routes/${day.route.id}`, label: "Route" }}
              empty={day.stops.length ? null : "No shops are on this route yet."}
            >
              <StatusList
                items={day.stops.map((stop) => ({
                  id: stop.id,
                  href: visitHref(stop),
                  name: `${stop.stop}. ${stop.name}`,
                  state: stop.visited ? { tone: "ok", label: "Visited" } : STATE[stop.state],
                  figure: money(stop.owes),
                  meta: stop.area ?? "",
                  sub: stop.overdue ? `${money(stop.overdue)} overdue` : "owes",
                }))}
              />
            </Panel>
          )}
        </DashboardFrame>
      )}
      {day?.next ? (
        <div className="sticky bottom-14 border-t border-border bg-background p-3 md:bottom-0">
          <Button variant="primary" className="h-11 w-full" asChild>
            <Link href={visitHref(day.next)}>Visit {day.next.name}</Link>
          </Button>
        </div>
      ) : null}
    </>
  );
}
