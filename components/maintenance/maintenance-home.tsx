"use client";

import { useQuery } from "@tanstack/react-query";

import { ActionList, type ActionItem } from "@/components/dashboard-frame/action-list";
import { DashboardFrame, DashSkeleton } from "@/components/dashboard-frame/dashboard-frame";
import { KpiTile } from "@/components/dashboard-frame/kpi-tile";
import { Panel } from "@/components/dashboard-frame/panel";
import { shopLongDay, shopTime } from "@/components/dashboard-frame/period-toolbar";
import { RankList } from "@/components/dashboard-frame/rank-list";
import { StatusList, type StatusItem } from "@/components/dashboard-frame/status-list";
import { PageChrome } from "@/components/layout/page-chrome";
import { LoadError } from "@/components/list-frame/list-states";
import { fetchJson, getApiErrorMessage } from "@/lib/api-client";
import type { maintenanceHome } from "@/lib/maintenance/overview";

type Home = Awaited<ReturnType<typeof maintenanceHome>>;

const ZONE = "Africa/Harare";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: ZONE, weekday: "short", day: "numeric", month: "short" });
const ago = (iso: string | null) => {
  if (!iso) return "";
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 0) return `due ${day(iso)}`;
  if (hours < 24) return `${Math.max(1, Math.round(hours))} h ago`;
  return `${Math.round(hours / 24)} days ago`;
};
const labels = (days: string[], format: (index: number) => string) => days.map((entry, index) => `${day(`${entry}T12:00:00Z`)} · ${format(index)}`);

/**
 * Assets' homepage, on core's DashboardFrame as Retail's and the mill's are:
 * four figures with their week, then what needs someone now (machines down,
 * services due and not booked), what is down, what is coming up, and where
 * the month's fuel went.
 */
export function MaintenanceHome() {
  const query = useQuery({ queryKey: ["maintenance", "home"], queryFn: () => fetchJson<Home>("/api/maintenance/home"), refetchInterval: 60_000 });
  const toolbar = (
    <div role="toolbar" aria-label="Assets" className="cx-df-toolbar cx-df-toolbar--wrap">
      <span className="cx-df-toolbar__quiet">Machinery and vehicles today</span>
      <span className="cx-df-toolbar__spacer" />
      {query.data ? (
        <span className="cx-df-live">
          <span className="cx-df-live__dot" aria-hidden="true" />
          Live · {shopLongDay(new Date(query.dataUpdatedAt))} · <span className="cx-df-mono">{shopTime(new Date(query.dataUpdatedAt))}</span>
        </span>
      ) : null}
    </div>
  );
  return (
    <>
      <PageChrome title="Assets" primary={{ label: "Log a breakdown", icon: "plus", sheet: "maint-breakdown" }} />
      {query.isError ? (
        <LoadError noun="assets" message={getApiErrorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DashboardFrame variant="overview" label="Assets" toolbar={toolbar}>
          {query.data ? <Tiles home={query.data} /> : <Loading />}
        </DashboardFrame>
      )}
    </>
  );
}

function Loading() {
  return (
    <>
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="cx-df-span-3">
          <DashSkeleton height={200} />
        </div>
      ))}
      <div className="cx-df-span-7">
        <DashSkeleton height={320} />
      </div>
      <div className="cx-df-span-5">
        <DashSkeleton height={320} />
      </div>
    </>
  );
}

function Tiles({ home }: { home: Home }) {
  const { kpis, days } = home;
  const actions: ActionItem[] = home.needsAction.map((row) => ({
    id: row.id,
    href: row.href,
    title: row.title,
    meta: [row.meta, ago(row.since)].filter(Boolean).join(" · "),
    figure: row.kind === "breakdown" ? "Down" : row.kind === "overdue" ? "Overdue" : "Due",
    figureTone: row.kind === "due" ? "warn" : "bad",
    dot: row.kind === "due" ? "warn" : "bad",
  }));
  const down: StatusItem[] = home.downNow.map((row) => ({
    id: row.id,
    href: `/maintenance/work-orders/${row.id}`,
    name: row.name,
    state: row.status === "IN_PROGRESS" ? { tone: "info", label: "Being mended" } : { tone: "bad", label: "Waiting" },
    figure: `${row.hours.toLocaleString("en-GB")} h`,
    meta: row.issue,
    sub: row.technician ?? "nobody on it",
  }));
  const comingUp: ActionItem[] = home.comingUp.map((row) => ({
    id: row.id,
    href: row.href,
    title: `${row.name}, ${row.equipment}`,
    meta: row.booked ? "Booked" : "Not booked yet",
    figure: day(row.at),
    dot: row.booked ? "info" : "warn",
  }));
  const mostFuel = Math.max(...home.fuelBy.map((row) => row.litres), 0);

  return (
    <>
      <KpiTile span={3} label="Down now" value={`${kpis.down.value}`} note={`of ${kpis.down.of} in use · breakdowns a day`} bars={kpis.down.bars} barLabels={labels(days, (index) => `${kpis.down.bars[index]} breakdowns`)} />
      <KpiTile span={3} label="Open work orders" value={`${kpis.open.value}`} note="raised a day" bars={kpis.open.bars} barLabels={labels(days, (index) => `${kpis.open.bars[index]} raised`)} />
      <KpiTile
        span={3}
        label="Services due"
        value={`${kpis.due.value}`}
        delta={kpis.due.overdue ? { text: `${kpis.due.overdue} overdue`, tone: "bad" } : null}
        note="services done a day"
        bars={kpis.due.bars}
        barLabels={labels(days, (index) => `${kpis.due.bars[index]} done`)}
      />
      <KpiTile span={3} label="Fuel this month" value={`${kpis.fuel.litres.toLocaleString("en-GB")} L`} note="litres a day" bars={kpis.fuel.bars} barLabels={labels(days, (index) => `${kpis.fuel.bars[index]} L`)} />

      <Panel span={7} title="Needs action" count={actions.length ? { value: actions.length, tone: "bad" } : null} link={{ href: "/maintenance/schedule/plans?tab=due", label: "Plans due" }} empty={actions.length ? null : "Nothing is down and every service is booked."}>
        <ActionList items={actions} />
      </Panel>
      <Panel span={5} title="Down now" count={{ value: down.length }} link={{ href: "/maintenance/equipment?tab=down", label: "Register" }} empty={down.length ? null : "Every machine and vehicle is working."}>
        <StatusList items={down} />
      </Panel>

      <Panel span={7} title="Coming up" qualifier="next 30 days" link={{ href: "/maintenance/schedule", label: "Calendar" }} empty={comingUp.length ? null : "No service falls in the next 30 days."}>
        <ActionList items={comingUp} />
      </Panel>
      <Panel span={5} title="Fuel this month" link={{ href: "/maintenance/fuel/usage", label: "Usage" }} empty={home.fuelBy.length ? null : "No fuel issued to a machine this month."}>
        <RankList
          head={["Machine or vehicle", "Litres"]}
          rows={home.fuelBy.map((row) => ({
            id: row.id,
            name: row.name,
            href: `/maintenance/equipment/${row.id}`,
            value: row.litres.toLocaleString("en-GB"),
            share: mostFuel ? row.litres / mostFuel : 0,
            meta: `US$${row.cost.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          }))}
        />
      </Panel>
    </>
  );
}
