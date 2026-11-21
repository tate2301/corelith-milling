"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { Field, FormError, isoFromLocal, localNow } from "@/components/milling/form-bits";
import { formatWhen, MillSelect } from "@/components/milling/mill-ui";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { useMillPost } from "@/components/milling/use-mill-post";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SectionTab, SectionTabs } from "@/components/ui/section-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/api-client";

type Machine = { id: string; equipmentCode: string; name: string; category: string; availability: string; openStop: { cause: string; startedAt: string } | null };
type Stop = { id: string; category: string; cause: string; startedAt: string; endedAt: string | null; hours: number; stageCode: string | null; equipment: { equipmentCode: string; name: string } | null };
type GeneratorRun = { id: string; startedAt: string; endedAt: string; hours: number; litres: number; reason: string | null };

const AVAILABILITY: Record<string, { label: string; tone: string }> = {
  AVAILABLE: { label: "Available", tone: "passing" },
  DOWN: { label: "Down", tone: "failing" },
  IN_REPAIR: { label: "In repair", tone: "in_progress" },
  AWAITING_RELEASE: { label: "Awaiting release", tone: "in_review" },
};

const CATEGORIES = [
  { value: "BREAKDOWN", label: "Breakdown" },
  { value: "POWER", label: "Power cut" },
  { value: "MATERIAL", label: "No material" },
  { value: "PLANNED", label: "Planned stop" },
  { value: "OTHER", label: "Other" },
];

/** The mill's machines: which can run, what stopped and for how long, and the generator log. */
export default function MillMaintenancePage() {
  const params = useSearchParams();
  const tab = params.get("tab") ?? "board";
  return (
    <>
      <PageChrome title="Machines" />
      <div className="space-y-4 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTabs label="Maintenance views">
            <SectionTab to="/milling/maintenance" active={tab === "board"}>
              Availability
            </SectionTab>
            <SectionTab to="/milling/downtime" active={false}>
              Stops
            </SectionTab>
            <SectionTab to="/milling/generator" active={false}>
              Generator
            </SectionTab>
          </SectionTabs>
          <ReportStop />
        </div>
        {tab === "stops" ? <Stops /> : tab === "generator" ? <Generator /> : <Board />}
      </div>
    </>
  );
}

function Board() {
  const access = useMillAccess();
  const act = useMillPost({ done: "Saved" });
  const query = useQuery({ queryKey: ["milling", "equipment"], queryFn: () => fetchJson<Machine[]>("/api/milling/equipment") });
  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (!query.data?.length) return <EmptyState title="No machines at the mill" body="Machines are added under Maintenance › Equipment." />;
  return (
    <>
      <FormError error={act.error} />
      <Table hideControlsWhenSinglePage>
        <TableHeader>
          <TableRow>
            <TableHead>Machine</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Stopped since</TableHead>
            <TableHead className="text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data.map((machine) => (
            <TableRow key={machine.id}>
              <TableCell>
                <span className="font-mono">{machine.equipmentCode}</span> {machine.name}
              </TableCell>
              <TableCell>
                <StatusChip status={AVAILABILITY[machine.availability]?.tone} label={AVAILABILITY[machine.availability]?.label ?? machine.availability} />
              </TableCell>
              <TableCell>{machine.openStop ? `${formatWhen(machine.openStop.startedAt)} · ${machine.openStop.cause}` : "—"}</TableCell>
              <TableCell className="space-x-2 text-right">
                {machine.availability === "DOWN" && access.can("fault.report") ? (
                  <Button size="sm" variant="ghost" onClick={() => act.post(`/api/milling/equipment/${machine.id}/in-repair`)}>
                    In repair
                  </Button>
                ) : null}
                {["DOWN", "IN_REPAIR"].includes(machine.availability) && access.can("fault.report") ? (
                  <Button size="sm" variant="ghost" onClick={() => act.post(`/api/milling/equipment/${machine.id}/repaired`)}>
                    Repaired
                  </Button>
                ) : null}
                {machine.availability !== "AVAILABLE" && access.can("machine.release") ? (
                  <Button size="sm" onClick={() => act.post(`/api/milling/equipment/${machine.id}/release`, { note: null })}>
                    Release for work
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}

function Stops() {
  const access = useMillAccess();
  const act = useMillPost({ done: "Stop ended" });
  const query = useQuery({ queryKey: ["milling", "downtime"], queryFn: () => fetchJson<Stop[]>("/api/milling/downtime") });
  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (!query.data?.length) return <EmptyState title="No stops recorded" body="Breakdowns, power cuts and waits for material appear here with their hours." />;
  return (
    <>
      <FormError error={act.error} />
      <Table hideControlsWhenSinglePage>
        <TableHeader>
          <TableRow>
            <TableHead>Started</TableHead>
            <TableHead>What</TableHead>
            <TableHead>Machine</TableHead>
            <TableHead>Cause</TableHead>
            <TableHead className="text-right">Hours</TableHead>
            <TableHead className="text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data.map((stop) => (
            <TableRow key={stop.id}>
              <TableCell>{formatWhen(stop.startedAt)}</TableCell>
              <TableCell>{CATEGORIES.find((category) => category.value === stop.category)?.label}</TableCell>
              <TableCell>{stop.equipment ? `${stop.equipment.equipmentCode} ${stop.equipment.name}` : "The line"}</TableCell>
              <TableCell>{stop.cause}</TableCell>
              <TableCell className="text-right font-mono">
                {stop.hours}
                {stop.endedAt ? "" : "+"}
              </TableCell>
              <TableCell className="text-right">
                {!stop.endedAt && stop.category !== "BREAKDOWN" && access.can("fault.report") ? (
                  <Button size="sm" variant="ghost" onClick={() => act.post(`/api/milling/downtime/${stop.id}/end`)}>
                    Ended now
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}

function ReportStop() {
  const access = useMillAccess();
  const [open, setOpen] = useState(false);
  const machines = useQuery({ queryKey: ["milling", "equipment"], queryFn: () => fetchJson<Machine[]>("/api/milling/equipment"), enabled: open });
  const [values, setValues] = useState({ category: "BREAKDOWN", equipmentId: "", cause: "", startedAt: localNow() });
  const save = useMillPost({ done: "Stop recorded", onDone: () => setOpen(false) });
  if (!access.can("fault.report")) return null;
  const set = (key: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [key]: value }));
  return (
    <>
      <Button onClick={() => setOpen(true)}>Report a stop</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report a stop</DialogTitle>
            <DialogDescription>A breakdown takes the machine out of use, raises a work order for the workshop, and needs a supervisor to release it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <MillSelect value={values.category} onChange={set("category")} options={CATEGORIES} />
            <MillSelect value={values.equipmentId} onChange={set("equipmentId")} placeholder="Machine" allowNone={values.category !== "BREAKDOWN"} options={(machines.data ?? []).map((machine) => ({ value: machine.id, label: `${machine.equipmentCode} · ${machine.name}` }))} />
            <Field id="stop-cause" label="What happened">
              <Input id="stop-cause" value={values.cause} onChange={(event) => set("cause")(event.target.value)} />
            </Field>
            <Field id="stop-start" label="Since">
              <Input id="stop-start" type="datetime-local" value={values.startedAt} onChange={(event) => set("startedAt")(event.target.value)} />
            </Field>
            <FormError error={save.error} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={save.pending} onClick={() => save.post("/api/milling/downtime", { ...values, equipmentId: values.equipmentId || null, startedAt: isoFromLocal(values.startedAt) })}>
              Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Generator() {
  const access = useMillAccess();
  const query = useQuery({ queryKey: ["milling", "generator"], queryFn: () => fetchJson<GeneratorRun[]>("/api/milling/generator") });
  const [values, setValues] = useState({ startedAt: "", endedAt: "", litres: "", reason: "" });
  const save = useMillPost({ done: "Run recorded", onDone: () => setValues({ startedAt: "", endedAt: "", litres: "", reason: "" }) });
  const set = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const totals = (query.data ?? []).reduce((sum, run) => ({ hours: sum.hours + run.hours, litres: sum.litres + run.litres }), { hours: 0, litres: 0 });
  return (
    <div className="space-y-4">
      {access.can("fuel.record") ? (
        <div className="grid max-w-3xl gap-3 sm:grid-cols-[1fr_1fr_7rem_1fr_auto] sm:items-end">
          <Field id="gen-start" label="Started">
            <Input id="gen-start" type="datetime-local" value={values.startedAt} onChange={set("startedAt")} />
          </Field>
          <Field id="gen-end" label="Stopped">
            <Input id="gen-end" type="datetime-local" value={values.endedAt} onChange={set("endedAt")} />
          </Field>
          <Field id="gen-litres" label="Litres">
            <Input id="gen-litres" className="font-mono" inputMode="decimal" value={values.litres} onChange={set("litres")} />
          </Field>
          <Field id="gen-reason" label="Why">
            <Input id="gen-reason" value={values.reason} onChange={set("reason")} placeholder="ZESA outage" />
          </Field>
          <Button disabled={save.pending} onClick={() => save.post("/api/milling/generator", { ...values, startedAt: isoFromLocal(values.startedAt), endedAt: isoFromLocal(values.endedAt), reason: values.reason || null })}>
            Record
          </Button>
        </div>
      ) : null}
      <FormError error={save.error} />
      {query.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : !query.data?.length ? (
        <EmptyState title="No generator runs" body="Each run's hours and diesel appear here." />
      ) : (
        <Table hideControlsWhenSinglePage>
          <TableHeader>
            <TableRow>
              <TableHead>Started</TableHead>
              <TableHead>Stopped</TableHead>
              <TableHead className="text-right">Hours</TableHead>
              <TableHead className="text-right">Litres</TableHead>
              <TableHead className="text-right">Litres an hour</TableHead>
              <TableHead>Why</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.map((run) => (
              <TableRow key={run.id}>
                <TableCell>{formatWhen(run.startedAt)}</TableCell>
                <TableCell>{formatWhen(run.endedAt)}</TableCell>
                <TableCell className="text-right font-mono">{run.hours}</TableCell>
                <TableCell className="text-right font-mono">{run.litres}</TableCell>
                <TableCell className="text-right font-mono">{run.hours ? (run.litres / run.hours).toFixed(1) : "—"}</TableCell>
                <TableCell>{run.reason ?? "—"}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={2} className="font-medium">
                Shown
              </TableCell>
              <TableCell className="text-right font-mono">{totals.hours.toFixed(1)}</TableCell>
              <TableCell className="text-right font-mono">{totals.litres.toFixed(0)}</TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </TableBody>
        </Table>
      )}
    </div>
  );
}
