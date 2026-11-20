"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";

import { PageChrome } from "@/components/layout/page-chrome";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson } from "@/lib/api-client";

type Day = {
  day: string;
  figures: { maizeKg: number; mealKg: number; extractionPct: number | null; downtimeHours: number; bagsOut: number };
  targetPct: number;
  shortfall: { points: number; run: string | null; runPct: number | null } | null;
  sites: Array<{ siteId: string; site: string; maizeKg: number | null; mealKg: number | null; downtimeHours: number | null; bagsOut: number | null }>;
};

const kg = (value: number, digits = 0) => `${value.toLocaleString("en-ZW", { minimumFractionDigits: digits, maximumFractionDigits: digits })} kg`;

/**
 * The director's Overview on a phone (HM-B1): yesterday across the sites in
 * five figures, a warning when extraction fell short of the target, then
 * each site in a line.
 */
export default function MillDirectorPage() {
  const query = useQuery({ queryKey: ["milling", "director"], queryFn: () => fetchJson<Day>("/api/milling/director") });
  const day = query.data;
  return (
    <>
      <PageChrome title="Overview" />
      <div className="mx-auto max-w-md space-y-5 px-4 pb-20 pt-2">
        {query.isPending ? (
          <Skeleton className="h-96 w-full" />
        ) : query.isError || !day ? (
          <EmptyState title="Yesterday did not load" body="Check the connection and try again." />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{new Date(`${day.day}T00:00:00`).toLocaleDateString("en-ZW", { weekday: "long", day: "numeric", month: "long" })}</p>
            <dl className="divide-y divide-border">
              <Line label="Maize received">{kg(day.figures.maizeKg, 1)}</Line>
              <Line label="Meal made">{kg(day.figures.mealKg)}</Line>
              <Line label="Extraction">{day.figures.extractionPct === null ? "—" : `${day.figures.extractionPct.toFixed(1)}%`}</Line>
              <Line label="Stopped">{`${day.figures.downtimeHours.toFixed(1)} h`}</Line>
              <div className="flex justify-between border-t-2 border-foreground py-3 font-semibold">
                <dt>Bags out</dt>
                <dd className="font-mono">{day.figures.bagsOut.toLocaleString("en-ZW")}</dd>
              </div>
            </dl>
            {day.shortfall ? (
              <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">
                <p className="font-medium">Extraction is {day.shortfall.points.toFixed(1)} points under target.</p>
                <p className="text-muted-foreground">
                  {day.figures.extractionPct?.toFixed(1)}% against {day.targetPct.toFixed(1)}%
                  {day.shortfall.run ? `; lowest on ${day.shortfall.run} at ${day.shortfall.runPct?.toFixed(1)}%` : ""}.
                </p>
              </div>
            ) : null}
            <section className="space-y-1">
              <h2 className="font-medium">By site</h2>
              <ul className="divide-y divide-border">
                {day.sites.map((site) => (
                  <li key={site.siteId} className="py-3">
                    <p className="font-medium">{site.site}</p>
                    <p className="text-sm text-muted-foreground">
                      {[
                        site.maizeKg ? `Maize received ${kg(site.maizeKg, 1)}` : null,
                        site.mealKg ? `meal ${kg(site.mealKg)}` : null,
                        site.bagsOut ? `${site.bagsOut.toLocaleString("en-ZW")} bags out` : null,
                      ]
                        .filter(Boolean)
                        .join(", ") || "Nothing recorded"}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between py-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono">{children}</dd>
    </div>
  );
}
