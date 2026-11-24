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

type Waiting = { key: string; code: string; what: string; href: string; sentBy: string | null; sentAt: string; quantity: string | null; bulk?: { kind: string } };
type Dashboard = {
  shift: { id: string; code: string; present: number; crew: number } | null;
  batches: Array<{ id: string; code: string; status: string; lastStage: string | null; maizeKg: number; outputKg: number }>;
  output: { plannedKg: number; madeKg: number };
  maize: { availableKg: number; onHoldKg: number };
  qc: { intakesWaiting: number; lotsOnHold: number };
  packed: Array<{ name: string; bags: number; reserved: number }>;
  machines: { down: Array<{ id?: string; equipmentCode?: string; name?: string; availability: string }>; hoursStoppedToday: number };
  deliveries: { planned: number; onTheRoad: number; toReconcile: number };
  week: { days: string[]; maizeKg: number[]; mealKg: number[]; bagsOut: number[]; downtimeHours: number[] };
  waiting: Waiting[];
  yesterday: {
    day: string;
    rows: Array<{ siteId: string; site: string; maizeKg: number | null; mealKg: number | null; downtimeHours: number | null; bagsOut: number | null }>;
    total: { maizeKg: number; mealKg: number; downtimeHours: number; bagsOut: number };
  };
};

const ZONE = "Africa/Harare";
const whole = (value: number) => Math.round(value).toLocaleString("en-GB");
const kg = (value: number) => (value >= 10_000 ? `${(value / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })} t` : `${whole(value)} kg`);
const hours = (value: number) => `${value.toLocaleString("en-GB", { maximumFractionDigits: 1 })} h`;
const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en-GB")} ${count === 1 ? one : many}`;
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: ZONE, weekday: "short", day: "numeric", month: "short" });
const sent = (at: string) => {
  const when = new Date(at);
  const days = Math.floor((Date.now() - when.getTime()) / 86_400_000);
  return days >= 2 ? `${days} days ago` : days === 1 ? "Yesterday" : shopTime(when);
};
const MACHINE_STATE: Record<string, string> = { DOWN: "Down", IN_REPAIR: "In repair", AWAITING_RELEASE: "To release" };

/** A change against the day before, worded for a tile note. */
function change(series: number[], format: (value: number) => string, upIsGood: boolean) {
  const today = series.at(-1) ?? 0;
  const before = series.at(-2) ?? 0;
  if (today === before) return { delta: null, note: before ? "same as yesterday" : null };
  const up = today > before;
  return { delta: { text: `${up ? "+" : "−"}${format(Math.abs(today - before))}`, tone: up === upIsGood ? ("ok" as const) : ("bad" as const) }, note: "on yesterday" };
}

/**
 * Overview (HM-A1), on core's DashboardFrame like Retail's: the day's four
 * figures with the week behind them, then what is waiting for this person,
 * the mill now, yesterday by site and the packed stock free to sell. Every
 * row opens the record or list it counts.
 */
export default function MillingHomePage() {
  const query = useQuery({ queryKey: ["milling", "dashboard"], queryFn: () => fetchJson<Dashboard>("/api/milling/dashboard"), refetchInterval: 60_000 });
  const toolbar = (
    <div role="toolbar" aria-label="The mill" className="cx-df-toolbar cx-df-toolbar--wrap">
      <span className="cx-df-toolbar__quiet">The mill today</span>
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
      <PageChrome title="Overview" />
      {query.isError ? (
        <LoadError noun="overview" message={getApiErrorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DashboardFrame variant="overview" label="Overview" toolbar={toolbar}>
          {query.data ? <Tiles data={query.data} /> : <Loading />}
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

function Tiles({ data }: { data: Dashboard }) {
  const { week } = data;
  const barLabels = (series: number[], format: (value: number) => string) => week.days.map((day, index) => `${dayLabel(day)} · ${format(series[index] ?? 0)}`);
  const meal = change(week.mealKg, kg, true);
  const maize = change(week.maizeKg, kg, true);
  const bags = change(week.bagsOut, whole, true);
  const stopped = change(week.downtimeHours, hours, false);

  const waiting: ActionItem[] = data.waiting.slice(0, 6).map((row) => ({
    id: row.key,
    href: row.href,
    title: `${row.code} · ${row.what}`,
    meta: [row.sentBy, sent(row.sentAt)].filter(Boolean).join(" · "),
    figure: row.quantity ?? "",
    dot: row.what.startsWith("Exception") || row.href.includes("exceptions") ? "bad" : row.bulk ? "info" : "warn",
  }));

  const now: StatusItem[] = [
    data.shift
      ? { id: "shift", href: `/milling/shifts/${data.shift.id}`, name: data.shift.code, state: { tone: "info", label: "On shift" }, figure: `${data.shift.present}/${data.shift.crew}`, meta: "Crew in", sub: "present" }
      : { id: "shift", href: "/milling/shifts", name: "No shift open", state: { tone: "hollow", label: "Closed" }, figure: "", meta: "Open one from Shifts", sub: "" },
    ...data.batches.map((batch): StatusItem => ({
      id: batch.id,
      href: `/milling/production/${batch.id}`,
      name: batch.code,
      state: batch.status === "AWAITING_DECISION" ? { tone: "warn", label: "On hold" } : { tone: "info", label: "Running" },
      figure: kg(batch.maizeKg),
      meta: batch.lastStage ? `At ${batch.lastStage.toLowerCase().replace(/_/g, " ")}` : "Not started",
      sub: batch.outputKg ? `${kg(batch.outputKg)} out` : "maize in",
    })),
    {
      id: "machines",
      href: "/milling/maintenance",
      name: "Machines",
      state: data.machines.down.length ? { tone: "bad", label: `${data.machines.down.length} out of use` } : { tone: "ok", label: "All working" },
      figure: data.machines.hoursStoppedToday ? hours(data.machines.hoursStoppedToday) : "",
      meta: data.machines.down.length ? data.machines.down.map((machine) => `${machine.equipmentCode ?? "?"} ${MACHINE_STATE[machine.availability]?.toLowerCase() ?? ""}`.trim()).join(", ") : "Nothing stopped",
      sub: data.machines.hoursStoppedToday ? "stopped today" : "",
    },
    {
      id: "maize",
      href: "/milling/stock",
      name: "Maize",
      state: data.qc.intakesWaiting || data.qc.lotsOnHold ? { tone: "warn", label: `${plural(data.qc.intakesWaiting + data.qc.lotsOnHold, "for QC", "for QC")}` } : { tone: "ok", label: "Nothing for QC" },
      figure: kg(data.maize.availableKg),
      meta: data.maize.onHoldKg ? `${kg(data.maize.onHoldKg)} on hold` : "None on hold",
      sub: "free to mill",
    },
    {
      id: "deliveries",
      href: "/milling/deliveries",
      name: "Deliveries",
      state: data.deliveries.toReconcile ? { tone: "warn", label: `${data.deliveries.toReconcile} to reconcile` } : { tone: "hollow", label: "Nothing to reconcile" },
      figure: `${data.deliveries.onTheRoad}`,
      meta: `${plural(data.deliveries.planned, "being loaded", "being loaded")}`,
      sub: "on the road",
    },
  ];

  const sites = data.yesterday.rows;
  const mostOut = Math.max(...sites.map((row) => row.bagsOut ?? 0), 0);
  const packed = data.packed.filter((row) => row.bags || row.reserved);
  const mostPacked = Math.max(...packed.map((row) => row.bags - row.reserved), 0);

  return (
    <>
      <KpiTile span={3} label="Meal made" value={kg(week.mealKg.at(-1) ?? 0)} delta={meal.delta} note={data.output.plannedKg ? `of ${kg(data.output.plannedKg)} planned` : meal.note} bars={week.mealKg} barLabels={barLabels(week.mealKg, kg)} />
      <KpiTile span={3} label="Maize received" value={kg(week.maizeKg.at(-1) ?? 0)} delta={maize.delta} note={maize.note} bars={week.maizeKg} barLabels={barLabels(week.maizeKg, kg)} />
      <KpiTile span={3} label="Bags out" value={whole(week.bagsOut.at(-1) ?? 0)} delta={bags.delta} note={bags.note} bars={week.bagsOut} barLabels={barLabels(week.bagsOut, whole)} />
      <KpiTile span={3} label="Machines stopped" value={hours(week.downtimeHours.at(-1) ?? 0)} delta={stopped.delta} note={stopped.note} bars={week.downtimeHours} barLabels={barLabels(week.downtimeHours, hours)} />

      <Panel
        span={7}
        title="Waiting for you"
        count={data.waiting.length ? { value: data.waiting.length, tone: "bad" } : null}
        link={data.waiting.length ? { href: "/milling/waiting", label: data.waiting.length > waiting.length ? `All ${data.waiting.length}` : "Decide" } : null}
        empty={data.waiting.length ? null : "Nothing is waiting for your decision."}
      >
        <ActionList items={waiting} />
      </Panel>

      <Panel span={5} title="The mill now">
        <StatusList items={now} />
      </Panel>

      <Panel span={7} title="Yesterday, all sites" qualifier={dayLabel(data.yesterday.day)} figure={`${whole(data.yesterday.total.bagsOut)} bags out`} empty={sites.length ? null : "No site is set up."}>
        <RankList
          head={["Site", "Bags out"]}
          rows={sites.map((row) => ({
            id: row.siteId,
            name: row.site,
            value: row.bagsOut ? whole(row.bagsOut) : "—",
            share: mostOut ? (row.bagsOut ?? 0) / mostOut : 0,
            meta: row.mealKg === null ? "Selling site" : `${kg(row.mealKg)} meal · ${kg(row.maizeKg ?? 0)} maize in · ${hours(row.downtimeHours ?? 0)} stopped`,
          }))}
        />
      </Panel>

      <Panel span={5} title="Packed and free" qualifier="bags" link={{ href: "/milling/stock", label: "Stock" }} empty={packed.length ? null : "No packed stock."}>
        <RankList
          head={["Product", "Free to sell"]}
          rows={packed.map((row) => ({
            id: row.name,
            name: row.name,
            value: whole(Math.max(row.bags - row.reserved, 0)),
            valueTone: row.bags - row.reserved <= 0 ? "bad" : null,
            share: mostPacked ? Math.max(row.bags - row.reserved, 0) / mostPacked : 0,
            barTone: row.bags - row.reserved <= 0 ? "warn" : null,
            meta: row.reserved ? `${whole(row.reserved)} promised of ${whole(row.bags)}` : `${whole(row.bags)} on hand`,
          }))}
        />
      </Panel>
    </>
  );
}
