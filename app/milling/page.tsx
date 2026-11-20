"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { PageChrome } from "@/components/layout/page-chrome";
import { formatKg } from "@/components/milling/mill-ui";
import { WaitingForYou, type WaitingRow } from "@/components/milling/waiting-for-you";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/api-client";

type Dashboard = {
  shift: { id: string; code: string; present: number; crew: number } | null;
  batches: Array<{ id: string; code: string; status: string; lastStage: string | null; maizeKg: number; outputKg: number }>;
  output: { plannedKg: number; madeKg: number };
  maize: { availableKg: number; onHoldKg: number };
  qc: { intakesWaiting: number; lotsOnHold: number };
  packed: Array<{ name: string; bags: number; reserved: number }>;
  machines: { down: Array<{ id?: string; equipmentCode?: string; name?: string; availability: string }>; hoursStoppedToday: number };
  deliveries: { planned: number; onTheRoad: number; toReconcile: number };
  exceptions: Array<{ id: string; code: string; title: string; targetType: string; targetId: string; createdAt: string }>;
  waiting: WaitingRow[];
  yesterday: {
    day: string;
    rows: Array<{ siteId: string; site: string; maizeKg: number | null; mealKg: number | null; downtimeHours: number | null; bagsOut: number | null }>;
    total: { maizeKg: number; mealKg: number; downtimeHours: number; bagsOut: number };
  };
};

const n = (value: number | null, digits = 0) => (value === null || value === 0 ? "—" : value.toLocaleString("en-ZW", { minimumFractionDigits: digits, maximumFractionDigits: digits }));

function Tile({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block rounded-md border p-4 transition-colors hover:bg-muted/50">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="mt-1 space-y-1">{children}</div>
    </Link>
  );
}

const Figure = ({ children }: { children: React.ReactNode }) => <div className="font-mono text-xl">{children}</div>;
const Note = ({ children }: { children: React.ReactNode }) => <div className="text-sm text-muted-foreground">{children}</div>;

/**
 * Overview (HM-A1): what is waiting for this person's decision, then
 * yesterday across the sites, then the mill now: who is on, what is running,
 * held, down and out on the road. Each waiting row opens its record, where
 * the decision is taken with its own checks.
 */
export default function MillingHomePage() {
  const query = useQuery({ queryKey: ["milling", "dashboard"], queryFn: () => fetchJson<Dashboard>("/api/milling/dashboard"), refetchInterval: 60_000 });
  const data = query.data;
  return (
    <>
      <PageChrome title="Overview" />
      <div className="space-y-6 px-4 py-4">
        {query.isPending || !data ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <>
            <WaitingForYou rows={data.waiting} />

            <section className="space-y-2">
              <div className="flex items-baseline justify-between">
                <h2 className="text-base font-semibold">Yesterday, all sites</h2>
                <span className="text-sm text-muted-foreground">{new Date(`${data.yesterday.day}T00:00:00`).toLocaleDateString("en-ZW", { weekday: "long", day: "numeric", month: "long" })}</span>
              </div>
              <div className="overflow-x-auto">
                <Table hideControlsWhenSinglePage>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Site</TableHead>
                      <TableHead className="text-right">Maize received kg</TableHead>
                      <TableHead className="text-right">Meal kg</TableHead>
                      <TableHead className="text-right">Downtime hours</TableHead>
                      <TableHead className="text-right">Bags out</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.yesterday.rows.map((row) => (
                      <TableRow key={row.siteId}>
                        <TableCell>{row.site}</TableCell>
                        <TableCell className="text-right font-mono">{n(row.maizeKg, 1)}</TableCell>
                        <TableCell className="text-right font-mono">{n(row.mealKg)}</TableCell>
                        <TableCell className="text-right font-mono">{row.downtimeHours === null ? "—" : row.downtimeHours.toFixed(1)}</TableCell>
                        <TableCell className="text-right font-mono">{n(row.bagsOut)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 border-border font-medium">
                      <TableCell>{data.yesterday.rows.length === 1 ? "Total" : `All ${data.yesterday.rows.length} sites`}</TableCell>
                      <TableCell className="text-right font-mono">{n(data.yesterday.total.maizeKg, 1)}</TableCell>
                      <TableCell className="text-right font-mono">{n(data.yesterday.total.mealKg)}</TableCell>
                      <TableCell className="text-right font-mono">{data.yesterday.total.downtimeHours.toFixed(1)}</TableCell>
                      <TableCell className="text-right font-mono">{n(data.yesterday.total.bagsOut)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </section>

            <h2 className="text-base font-semibold">Now</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Tile title="On shift" href={data.shift ? `/milling/shifts/${data.shift.id}` : "/milling/shifts"}>
                {data.shift ? (
                  <>
                    <Figure>
                      {data.shift.present}/{data.shift.crew}
                    </Figure>
                    <Note>{data.shift.code}</Note>
                  </>
                ) : (
                  <Note>No shift is open.</Note>
                )}
              </Tile>
              <Tile title="Made today against plan" href="/milling/production">
                <Figure>{formatKg(data.output.madeKg)}</Figure>
                <Note>{data.output.plannedKg ? `of ${formatKg(data.output.plannedKg)} planned` : "Nothing planned for today"}</Note>
              </Tile>
              <Tile title="Maize free to mill" href="/milling/stock">
                <Figure>{formatKg(data.maize.availableKg)}</Figure>
                <Note>{data.maize.onHoldKg ? `${formatKg(data.maize.onHoldKg)} on hold` : "None on hold"}</Note>
              </Tile>
              <Tile title="Waiting for QC" href="/milling/quality">
                <Figure>{data.qc.intakesWaiting + data.qc.lotsOnHold}</Figure>
                <Note>
                  {data.qc.intakesWaiting} deliveries, {data.qc.lotsOnHold} lots on hold
                </Note>
              </Tile>
              <Tile title="Machines" href="/milling/maintenance">
                <Figure>{data.machines.down.length ? `${data.machines.down.length} not working` : "All working"}</Figure>
                <Note>
                  {data.machines.down.map((machine) => machine.equipmentCode).join(", ")}
                  {data.machines.hoursStoppedToday ? ` · ${data.machines.hoursStoppedToday} h stopped today` : ""}
                </Note>
              </Tile>
              <Tile title="Deliveries" href="/milling/deliveries">
                <Figure>{data.deliveries.onTheRoad} on the road</Figure>
                <Note>
                  {data.deliveries.planned} being loaded, {data.deliveries.toReconcile} to reconcile
                </Note>
              </Tile>
              <Tile title="Running batches" href="/milling/production">
                {data.batches.length ? (
                  data.batches.map((batch) => (
                    <div key={batch.id} className="text-sm">
                      <span className="font-mono">{batch.code}</span> · {batch.lastStage ? `at ${batch.lastStage.toLowerCase()}` : "not started"} · {formatKg(batch.maizeKg)} in
                    </div>
                  ))
                ) : (
                  <Note>None running.</Note>
                )}
              </Tile>
              <Tile title="Packed and free" href="/milling/stock">
                {data.packed.filter((row) => row.bags).length ? (
                  data.packed
                    .filter((row) => row.bags)
                    .map((row) => (
                      <div key={row.name} className="flex justify-between text-sm">
                        <span>{row.name}</span>
                        <span className="font-mono">
                          {row.bags - row.reserved}
                          {row.reserved ? ` (+${row.reserved} promised)` : ""}
                        </span>
                      </div>
                    ))
                ) : (
                  <Note>No packed stock.</Note>
                )}
              </Tile>
            </div>
          </>
        )}
      </div>
    </>
  );
}
