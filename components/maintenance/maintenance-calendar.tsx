"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { PageChrome } from "@/components/layout/page-chrome";
import { LoadError } from "@/components/list-frame/list-states";
import { Button } from "@/components/workspace/button";
import { useHydrated } from "@/hooks/use-hydrated";
import { fetchJson, getApiErrorMessage } from "@/lib/api-client";
import type { CalendarItem } from "@/lib/maintenance/overview";

import styles from "./maintenance-calendar.module.css";

const KINDS: Array<{ kind: CalendarItem["kind"]; label: string }> = [
  { kind: "due", label: "Due, not booked" },
  { kind: "booked", label: "Booked" },
  { kind: "forecast", label: "Forecast" },
  { kind: "done", label: "Done" },
  { kind: "breakdown", label: "Breakdown" },
];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHOWN = 3;

const thisMonth = () => new Date().toISOString().slice(0, 7);
function shift(month: string, by: number) {
  const [year, index] = month.split("-").map(Number) as [number, number];
  const at = new Date(Date.UTC(year, index - 1 + by, 1));
  return at.toISOString().slice(0, 7);
}
/** The month's grid, Monday first, with the days either side that fill its weeks. */
function weeksOf(month: string) {
  const first = new Date(`${month}-01T00:00:00Z`);
  const lead = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - lead * 86_400_000);
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const cells = Math.ceil((lead + last.getUTCDate()) / 7) * 7;
  return Array.from({ length: cells }, (_, index) => new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10));
}

/**
 * Preventive maintenance by month: each day's services, booked or still to
 * book, the repeats a date plan is forecast to need, what was done and what
 * broke down. A service due and not booked opens Book; anything else opens
 * its work order or plan.
 */
export function MaintenanceCalendar() {
  // "Today" and this month are the browser's: the server's clock and zone can differ.
  const hydrated = useHydrated();
  const params = useSearchParams();
  const router = useRouter();
  const month = /^\d{4}-\d{2}$/.test(params.get("month") ?? "") ? params.get("month")! : thisMonth();
  const query = useQuery({ queryKey: ["maintenance", "calendar", month], queryFn: () => fetchJson<{ month: string; items: CalendarItem[] }>(`/api/maintenance/calendar?month=${month}`), enabled: hydrated });
  const go = (to: string) => router.replace(`/maintenance/schedule?month=${to}`);
  const today = hydrated ? new Date().toISOString().slice(0, 10) : "";
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of query.data?.items ?? []) byDay.set(item.day, [...(byDay.get(item.day) ?? []), item]);
  const name = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  return (
    <>
      <PageChrome title="Preventive maintenance" primary={{ label: "Add a plan", icon: "plus", sheet: "maint-plan" }}>
        <Button asChild>
          <Link href="/maintenance/schedule/plans">All plans</Link>
        </Button>
      </PageChrome>
      <div role="toolbar" aria-label="Month" className="cx-df-toolbar cx-df-toolbar--wrap">
        <Button iconOnly aria-label="The month before" onClick={() => go(shift(month, -1))}>
          ‹
        </Button>
        <strong style={{ minWidth: 140, textAlign: "center" }}>{name}</strong>
        <Button iconOnly aria-label="The month after" onClick={() => go(shift(month, 1))}>
          ›
        </Button>
        {month !== thisMonth() ? (
          <Button onClick={() => go(thisMonth())}>
            This month
          </Button>
        ) : null}
        <span className="cx-df-toolbar__spacer" />
        <span className="cx-df-toolbar__quiet">{query.data ? `${query.data.items.length} in ${name.split(" ")[0]}` : ""}</span>
      </div>
      {!hydrated ? null : query.isError ? (
        <LoadError noun="calendar" message={getApiErrorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <div className={styles.wrap}>
          <div className={styles.legend} aria-hidden="true">
            {KINDS.map((entry) => (
              <span key={entry.kind}>
                <i className={`${styles.dot} ${styles.chip} ${styles[entry.kind]}`} />
                {entry.label}
              </span>
            ))}
          </div>
          <div className={styles.grid} role="grid" aria-label={name}>
            {DAYS.map((label) => (
              <div key={label} className={styles.head} role="columnheader">
                {label}
              </div>
            ))}
            {weeksOf(month).map((date) => {
              const items = byDay.get(date) ?? [];
              const outside = !date.startsWith(month);
              return (
                <div key={date} role="gridcell" className={[styles.cell, outside ? styles.outside : "", date === today ? styles.today : ""].join(" ")}>
                  <span className={styles.date}>{Number(date.slice(8))}</span>
                  {items.slice(0, SHOWN).map((item) => (
                    <Link key={item.id} href={item.href} className={`${styles.chip} ${styles[item.kind]}`} title={`${item.title}, ${item.equipment}`}>
                      {item.title} <small>{item.equipment}</small>
                    </Link>
                  ))}
                  {items.length > SHOWN ? <span className={styles.more}>{items.length - SHOWN} more</span> : null}
                </div>
              );
            })}
          </div>
          <div className={styles.agenda}>
            {[...byDay.entries()].map(([date, items]) => (
              <div key={date} className={styles.agendaDay}>
                <span className={styles.date}>{new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</span>
                {items.map((item) => (
                  <Link key={item.id} href={item.href} className={`${styles.chip} ${styles[item.kind]}`}>
                    {item.title} <small>{item.equipment}</small>
                  </Link>
                ))}
              </div>
            ))}
            {!byDay.size ? <p style={{ padding: 14, color: "var(--ink-3)" }}>Nothing falls in {name}.</p> : null}
          </div>
        </div>
      )}
    </>
  );
}
