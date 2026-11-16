"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { PageChrome } from "@/components/layout/page-chrome";
import { formatKg, formatWhen } from "@/components/milling/mill-ui";
import { targetHref } from "@/components/milling/targets";
import { Skeleton } from "@/components/ui/skeleton";
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
};

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

/** The mill now: who is on, what is running, what is held, what is down, what is waiting for a decision. */
export default function MillingHomePage() {
  const query = useQuery({ queryKey: ["milling", "dashboard"], queryFn: () => fetchJson<Dashboard>("/api/milling/dashboard"), refetchInterval: 60_000 });
  const data = query.data;
  return (
    <>
      <PageChrome title="The mill" />
      <div className="space-y-6 px-4 py-4">
        {query.isPending || !data ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <>
            {data.exceptions.length ? (
              <section className="space-y-2 rounded-md border p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold">Waiting for a decision</h2>
                  <Link className="text-sm underline" href="/milling/exceptions">
                    All exceptions
                  </Link>
                </div>
                <ul className="space-y-1 text-sm">
                  {data.exceptions.map((exception) => (
                    <li key={exception.id}>
                      <span className="font-mono">{exception.code}</span>{" "}
                      {targetHref(exception.targetType, exception.targetId) ? (
                        <Link className="underline" href={targetHref(exception.targetType, exception.targetId)!}>
                          {exception.title}
                        </Link>
                      ) : (
                        exception.title
                      )}{" "}
                      <span className="text-muted-foreground">· {formatWhen(exception.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
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
