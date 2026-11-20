"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { PageChrome } from "@/components/layout/page-chrome";
import { SectionTab, SectionTabs } from "@/components/ui/section-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/api-client";

type Step = { key: string; step: string; layer: string; owner: string; state: "DONE" | "STARTED" | "WAITING" | "NOT_STARTED"; detail: string; href: string };

const STATE: Record<Step["state"], { label: string; tone: string }> = {
  DONE: { label: "Done", tone: "passing" },
  STARTED: { label: "Started", tone: "in_progress" },
  WAITING: { label: "Waiting", tone: "need_changes" },
  NOT_STARTED: { label: "Not started", tone: "inactive" },
};

/**
 * Go-live (GL-A1): the seven steps before the mill's first day. Each step's
 * state is read from what is there (sites, users in groups, priced and
 * weighed products, the till's fiscal device, the opening stock, Books'
 * opening balances, recipes and specs), never from a link being visited.
 */
export default function MillGoLivePage() {
  const params = useSearchParams();
  const tab = params.get("tab") ?? "all";
  const query = useQuery({ queryKey: ["milling", "go-live"], queryFn: () => fetchJson<{ steps: Step[] }>("/api/milling/go-live") });
  const steps = query.data?.steps ?? [];
  const shown = steps.filter((step) => (tab === "waiting" ? step.state === "WAITING" : tab === "done" ? step.state === "DONE" : true));
  return (
    <>
      <PageChrome title="Go-live" />
      <div className="space-y-4 px-4 py-2">
        <SectionTabs label="Go-live steps">
          <SectionTab to="/milling/go-live" active={tab === "all"} count={steps.length || undefined}>
            All
          </SectionTab>
          <SectionTab to="/milling/go-live?tab=waiting" active={tab === "waiting"} count={steps.filter((step) => step.state === "WAITING").length}>
            Waiting
          </SectionTab>
          <SectionTab to="/milling/go-live?tab=done" active={tab === "done"} count={steps.filter((step) => step.state === "DONE").length}>
            Done
          </SectionTab>
        </SectionTabs>
        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : query.isError ? (
          <EmptyState title="Go-live did not load" body="Check the connection and try again." />
        ) : !shown.length ? (
          <EmptyState title="Nothing here" body={tab === "waiting" ? "No step is waiting on anyone." : "No step is done yet."} />
        ) : (
          <>
            <ul className="divide-y divide-border rounded-md border border-border md:hidden">
              {shown.map((step) => (
                <li key={step.key} className="space-y-1 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link className="font-medium underline" href={step.href}>
                      {step.step}
                    </Link>
                    <StatusChip status={STATE[step.state].tone} label={STATE[step.state].label} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {step.owner} · {step.detail}
                  </p>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table hideControlsWhenSinglePage>
                <TableHeader>
                  <TableRow>
                    <TableHead>Step</TableHead>
                    <TableHead>Layer</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((step) => (
                    <TableRow key={step.key}>
                      <TableCell>
                        <Link className="underline" href={step.href}>
                          {step.step}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono">{step.layer}</TableCell>
                      <TableCell>{step.owner}</TableCell>
                      <TableCell>
                        <StatusChip status={STATE[step.state].tone} label={STATE[step.state].label} />
                      </TableCell>
                      <TableCell>{step.detail}</TableCell>
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
