"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { Field, FormError, Stat } from "@/components/milling/form-bits";
import { formatWhen, MillSelect, MillStatus } from "@/components/milling/mill-ui";
import { RecordHistory } from "@/components/milling/record-history";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { useMillPost } from "@/components/milling/use-mill-post";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SectionTab, SectionTabs } from "@/components/ui/section-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/api-client";

type Assignment = { id: string; employeeId: string; name: string; number: string; dutyId: string | null; attendance: string; clockIn: string | null; clockOut: string | null; breakMinutes: number; overtimeHours: number; absenceReason: string | null };
type Detail = {
  shift: { id: string; code: string; kind: string; status: string; scheduledStart: string; scheduledEnd: string; actualStart: string | null; actualEnd: string | null; materialInProcessKg: number | null; handoverNotes: string | null; assignments: Assignment[] };
  duties: Array<{ id: string; name: string }>;
  batches: Array<{ id: string; code: string; status: string }>;
  downtime: Array<{ id: string; cause: string; category: string; startedAt: string; endedAt: string | null }>;
  bagsPacked: number;
};

const ATTENDANCE = [
  { value: "PRESENT", label: "Present" },
  { value: "LATE", label: "Late" },
  { value: "ABSENT", label: "Absent" },
  { value: "ON_LEAVE", label: "On leave" },
];

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-ZW", { hour: "2-digit", minute: "2-digit" }) : "");

/** One shift: the crew and their time, what ran, what stopped, and the handover. */
export default function ShiftPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<"crew" | "work" | "history">("crew");
  const query = useQuery({ queryKey: ["milling", "shift", id], queryFn: () => fetchJson<Detail>(`/api/milling/shifts/${id}`) });
  if (query.isLoading || !query.data) return <Skeleton className="m-4 h-96" />;
  const { shift } = query.data;
  return (
    <>
      <PageChrome title={`Shift ${shift.code}`} />
      <div className="space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <MillStatus status={shift.status} />
          <span className="text-sm text-muted-foreground">
            {formatWhen(shift.actualStart ?? shift.scheduledStart)} to {formatWhen(shift.actualEnd ?? shift.scheduledEnd)}
          </span>
        </div>
        <SectionTabs label="Shift sections">
          <SectionTab onClick={() => setTab("crew")} active={tab === "crew"}>
            Crew
          </SectionTab>
          <SectionTab onClick={() => setTab("work")} active={tab === "work"}>
            Work and handover
          </SectionTab>
          <SectionTab onClick={() => setTab("history")} active={tab === "history"}>
            History
          </SectionTab>
        </SectionTabs>
        {tab === "crew" ? <Crew detail={query.data} /> : tab === "work" ? <Work detail={query.data} /> : <RecordHistory entityType="MillingShift" entityId={shift.id} />}
      </div>
    </>
  );
}

function Crew({ detail }: { detail: Detail }) {
  const { shift, duties } = detail;
  const access = useMillAccess();
  const save = useMillPost();
  const editable = ["PLANNED", "OPEN"].includes(shift.status) && access.can("shift.manage");
  const update = (employeeId: string, patch: Record<string, unknown>) => save.post(`/api/milling/shifts/${shift.id}/crew`, { employeeId, ...patch });
  const withTime = (base: string | null, hhmm: string) => {
    const day = new Date(base ?? shift.scheduledStart);
    const [hours, minutes] = hhmm.split(":").map(Number);
    day.setHours(hours, minutes, 0, 0);
    if (day < new Date(shift.scheduledStart)) day.setDate(day.getDate() + 1);
    return day.toISOString();
  };
  return (
    <div className="space-y-3">
      <FormError error={save.error} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            <TableHead>Duty</TableHead>
            <TableHead>Attendance</TableHead>
            <TableHead>In</TableHead>
            <TableHead>Out</TableHead>
            <TableHead className="text-right">Break min</TableHead>
            <TableHead className="text-right">Overtime h</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shift.assignments.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                {row.name}
                {row.absenceReason ? <div className="text-xs text-muted-foreground">{row.absenceReason}</div> : null}
              </TableCell>
              <TableCell>
                {editable ? (
                  <MillSelect value={row.dutyId} onChange={(dutyId) => update(row.employeeId, { dutyId: dutyId || null })} allowNone options={duties.map((duty) => ({ value: duty.id, label: duty.name }))} />
                ) : (
                  duties.find((duty) => duty.id === row.dutyId)?.name ?? "—"
                )}
              </TableCell>
              <TableCell>
                {editable ? (
                  <MillSelect
                    value={row.attendance}
                    onChange={(attendance) => {
                      const reason = attendance === "ABSENT" || attendance === "ON_LEAVE" ? window.prompt("Why are they not at work?") : null;
                      update(row.employeeId, { attendance, ...(reason ? { absenceReason: reason } : {}) });
                    }}
                    options={ATTENDANCE}
                  />
                ) : (
                  ATTENDANCE.find((entry) => entry.value === row.attendance)?.label
                )}
              </TableCell>
              <TableCell>
                {editable ? <Input type="time" aria-label={`${row.name} clocked in`} defaultValue={time(row.clockIn)} onBlur={(event) => event.target.value && update(row.employeeId, { clockIn: withTime(row.clockIn, event.target.value) })} /> : time(row.clockIn) || "—"}
              </TableCell>
              <TableCell>
                {editable ? <Input type="time" aria-label={`${row.name} clocked out`} defaultValue={time(row.clockOut)} onBlur={(event) => event.target.value && update(row.employeeId, { clockOut: withTime(row.clockOut ?? row.clockIn, event.target.value) })} /> : time(row.clockOut) || "—"}
              </TableCell>
              <TableCell className="text-right">
                {editable ? <Input className="w-20 text-right font-mono" inputMode="numeric" aria-label={`${row.name} break minutes`} defaultValue={String(row.breakMinutes)} onBlur={(event) => update(row.employeeId, { breakMinutes: Number(event.target.value || 0) })} /> : <span className="font-mono">{row.breakMinutes}</span>}
              </TableCell>
              <TableCell className="text-right font-mono">{Number(row.overtimeHours) || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ShiftActions detail={detail} />
    </div>
  );
}

function ShiftActions({ detail }: { detail: Detail }) {
  const { shift } = detail;
  const access = useMillAccess();
  const act = useMillPost({ done: "Saved" });
  const [material, setMaterial] = useState("");
  const [estimated, setEstimated] = useState(true);
  const [handover, setHandover] = useState("");
  return (
    <div className="max-w-xl space-y-3">
      {shift.status === "OPEN" && access.can("shift.manage") ? (
        <div className="space-y-3 rounded-md border p-4">
          <Field id="material" label="Left in machines and bins at close (kg)">
            <Input id="material" className="font-mono" inputMode="decimal" value={material} onChange={(event) => setMaterial(event.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={estimated} onCheckedChange={(on) => setEstimated(on === true)} /> Estimated, not measured
          </label>
          <Field id="handover" label="Handover notes">
            <Textarea id="handover" rows={3} value={handover} onChange={(event) => setHandover(event.target.value)} />
          </Field>
        </div>
      ) : null}
      <FormError error={act.error} />
      <div className="flex flex-wrap gap-2">
        {shift.status === "PLANNED" && access.can("shift.manage") ? <Button onClick={() => act.post(`/api/milling/shifts/${shift.id}/open`)}>Open the shift</Button> : null}
        {shift.status === "OPEN" && access.can("shift.manage") ? (
          <Button onClick={() => act.post(`/api/milling/shifts/${shift.id}/close`, { materialInProcessKg: material, materialEstimated: estimated, handoverNotes: handover || null })}>Close the shift</Button>
        ) : null}
        {shift.status === "CLOSED" && access.can("shift.approve") ? <Button onClick={() => act.post(`/api/milling/shifts/${shift.id}/approve`)}>Approve, and send attendance to payroll</Button> : null}
      </div>
    </div>
  );
}

function Work({ detail }: { detail: Detail }) {
  const { shift, batches, downtime } = detail;
  return (
    <div className="space-y-6 text-sm">
      <dl className="grid gap-4 sm:grid-cols-3">
        <Stat label="Batches">{batches.length}</Stat>
        <Stat label="Bags packed">
          <span className="font-mono">{detail.bagsPacked}</span>
        </Stat>
        <Stat label="Left in the line at close">
          <span className="font-mono">{shift.materialInProcessKg === null ? "—" : `${shift.materialInProcessKg} kg`}</span>
        </Stat>
      </dl>
      <section className="space-y-1">
        <h2 className="text-base font-semibold">Batches</h2>
        {batches.length ? (
          batches.map((batch) => (
            <div key={batch.id}>
              <Link className="font-mono underline" href={`/milling/production/${batch.id}`}>
                {batch.code}
              </Link>{" "}
              <MillStatus status={batch.status} />
            </div>
          ))
        ) : (
          <p className="text-muted-foreground">None on this shift.</p>
        )}
      </section>
      <section className="space-y-1">
        <h2 className="text-base font-semibold">Stops</h2>
        {downtime.length ? (
          downtime.map((stop) => (
            <div key={stop.id}>
              {formatWhen(stop.startedAt)}–{stop.endedAt ? formatWhen(stop.endedAt) : "still stopped"} · {stop.category.toLowerCase()} · {stop.cause}
            </div>
          ))
        ) : (
          <p className="text-muted-foreground">No stops recorded.</p>
        )}
      </section>
      {shift.handoverNotes ? (
        <section className="space-y-1">
          <h2 className="text-base font-semibold">Handover</h2>
          <p className="whitespace-pre-wrap">{shift.handoverNotes}</p>
        </section>
      ) : null}
    </div>
  );
}
