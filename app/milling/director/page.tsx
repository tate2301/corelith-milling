"use client";

import { useQuery } from "@tanstack/react-query";

import { DashboardFrame, DashSkeleton } from "@/components/dashboard-frame/dashboard-frame";
import { KpiStrip } from "@/components/dashboard-frame/kpi-tile";
import { Panel } from "@/components/dashboard-frame/panel";
import { StatusList } from "@/components/dashboard-frame/status-list";
import { PageChrome } from "@/components/layout/page-chrome";
import { LoadError } from "@/components/list-frame/list-states";
import { fetchJson, getApiErrorMessage } from "@/lib/api-client";

type Day = {
  day: string;
  figures: { maizeKg: number; mealKg: number; extractionPct: number | null; downtimeHours: number; bagsOut: number };
  targetPct: number;
  shortfall: { points: number; run: string | null; runPct: number | null } | null;
  sites: Array<{ siteId: string; site: string; maizeKg: number | null; mealKg: number | null; downtimeHours: number | null; bagsOut: number | null }>;
};

const ZONE = "Africa/Harare";
const whole = (value: number) => Math.round(value).toLocaleString("en-GB");
const kg = (value: number) => (value >= 10_000 ? `${(value / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })} t` : `${whole(value)} kg`);
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: ZONE, weekday: "long", day: "numeric", month: "long" });

/**
 * The director's Overview (HM-B1), on core's DashboardFrame: yesterday across
 * the sites in five figures, a warning when extraction fell short of the
 * target, then each site and its bags out.
 */
export default function MillDirectorPage() {
  const query = useQuery({ queryKey: ["milling", "director"], queryFn: () => fetchJson<Day>("/api/milling/director") });
  const day = query.data;
  const toolbar = (
    <div role="toolbar" aria-label="Day" className="cx-df-toolbar cx-df-toolbar--wrap">
      <span className="cx-df-toolbar__quiet">{day ? `Yesterday · ${longDay(day.day)}` : "Yesterday"}</span>
    </div>
  );
  return (
    <>
      <PageChrome title="Overview" />
      {query.isError ? (
        <LoadError noun="overview" message={getApiErrorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DashboardFrame variant="overview" label="Yesterday" toolbar={toolbar}>
          {!day ? (
            <>
              <div className="cx-df-span-12">
                <DashSkeleton height={96} />
              </div>
              <div className="cx-df-span-12">
                <DashSkeleton height={240} />
              </div>
            </>
          ) : (
            <>
              <div className="cx-df-span-12">
                <KpiStrip
                  items={[
                    { label: "Maize received", value: kg(day.figures.maizeKg) },
                    { label: "Meal made", value: kg(day.figures.mealKg) },
                    {
                      label: "Extraction",
                      value: day.figures.extractionPct === null ? "—" : `${day.figures.extractionPct.toFixed(1)}%`,
                      delta: day.shortfall ? { text: `−${day.shortfall.points.toFixed(1)} pts`, tone: "bad" } : null,
                      note: `target ${day.targetPct.toFixed(1)}%`,
                    },
                    { label: "Stopped", value: `${day.figures.downtimeHours.toFixed(1)} h` },
                    { label: "Bags out", value: whole(day.figures.bagsOut) },
                  ]}
                />
              </div>
              {day.shortfall ? (
                <Panel span={12} title="Extraction under target" count={{ value: `${day.shortfall.points.toFixed(1)} pts`, tone: "bad" }} link={{ href: "/milling/production", label: "Runs" }}>
                  <p className="cx-df-panel__empty">
                    {day.figures.extractionPct?.toFixed(1)}% against {day.targetPct.toFixed(1)}%
                    {day.shortfall.run ? `; lowest on ${day.shortfall.run} at ${day.shortfall.runPct?.toFixed(1)}%` : ""}.
                  </p>
                </Panel>
              ) : null}
              <Panel span={12} title="By site" figure={`${whole(day.figures.bagsOut)} bags out`} empty={day.sites.length ? null : "No site is set up."}>
                <StatusList
                  items={day.sites.map((site) => ({
                    id: site.siteId,
                    name: site.site,
                    state: site.mealKg === null ? { tone: "neutral" as const, label: "Selling site" } : { tone: "hollow" as const, label: "Mill" },
                    figure: site.bagsOut ? whole(site.bagsOut) : "—",
                    meta: site.mealKg === null ? "" : `${kg(site.mealKg)} meal · ${kg(site.maizeKg ?? 0)} maize in · ${(site.downtimeHours ?? 0).toFixed(1)} h stopped`,
                    sub: "bags out",
                  }))}
                />
              </Panel>
            </>
          )}
        </DashboardFrame>
      )}
    </>
  );
}
