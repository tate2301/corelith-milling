"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { Field, FormError } from "@/components/milling/form-bits";
import { formatWhen, MillSelect, MillStatus } from "@/components/milling/mill-ui";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { useMillPost } from "@/components/milling/use-mill-post";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/api-client";

type Shift = { id: string; code: string; kind: string; status: string; scheduledStart: string; scheduledEnd: string; assignments: Array<{ attendance: string }> };
type People = { employees: Array<{ id: string; name: string; employeeId: string; jobTitle: string | null }>; users: Array<{ id: string; name: string }> };
type Duty = { id: string; name: string; isActive: boolean };

/** The mill's shifts, newest first: planned, running, closed and approved. */
export default function MillShiftsPage() {
  const router = useRouter();
  const access = useMillAccess();
  const query = useQuery({ queryKey: ["milling", "shifts"], queryFn: () => fetchJson<Shift[]>("/api/milling/shifts") });
  return (
    <>
      <PageChrome title="Shifts" />
      <div className="space-y-4 px-4 py-2">
        <div className="flex justify-end">{access.can("shift.manage") ? <PlanShift onCreated={(id) => router.push(`/milling/shifts/${id}`)} /> : null}</div>
        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : !query.data?.length ? (
          <EmptyState title="No shifts yet" body="Plan a shift and its crew; open it when work starts." />
        ) : (
          <Table hideControlsWhenSinglePage>
            <TableHeader>
              <TableRow>
                <TableHead>Shift</TableHead>
                <TableHead>Starts</TableHead>
                <TableHead>Ends</TableHead>
                <TableHead className="text-right">Present</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((shift) => (
                <TableRow key={shift.id} className="cursor-pointer" onClick={() => router.push(`/milling/shifts/${shift.id}`)}>
                  <TableCell className="font-mono">{shift.code}</TableCell>
                  <TableCell>{formatWhen(shift.scheduledStart)}</TableCell>
                  <TableCell>{formatWhen(shift.scheduledEnd)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {shift.assignments.filter((row) => row.attendance === "PRESENT" || row.attendance === "LATE").length}/{shift.assignments.length}
                  </TableCell>
                  <TableCell>
                    <MillStatus status={shift.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}

function PlanShift({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const people = useQuery({ queryKey: ["milling", "people"], queryFn: () => fetchJson<People>("/api/milling/people"), enabled: open });
  const duties = useQuery({ queryKey: ["milling", "settings", "duties"], queryFn: () => fetchJson<{ rows: Duty[] }>("/api/milling/settings/duties"), enabled: open });
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [kind, setKind] = useState("DAY");
  const [start, setStart] = useState("06:00");
  const [supervisorId, setSupervisorId] = useState("");
  const [crew, setCrew] = useState<Record<string, string>>({});
  const plan = useMillPost<{ id: string }>({ onDone: (shift) => onCreated(shift.id) });
  const activeDuties = (duties.data?.rows ?? []).filter((duty) => duty.isActive);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Plan a shift</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Plan a shift</DialogTitle>
            <DialogDescription>Choose the crew and their duties. A night shift belongs to the day it starts.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Field id="shift-date" label="Day">
                <Input id="shift-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </Field>
              <Field id="shift-kind" label="Shift">
                <MillSelect id="shift-kind" value={kind} onChange={(value) => (setKind(value), setStart(value === "DAY" ? "06:00" : "22:00"))} options={[{ value: "DAY", label: "Day" }, { value: "NIGHT", label: "Night" }]} />
              </Field>
              <Field id="shift-start" label="Starts">
                <Input id="shift-start" type="time" value={start} onChange={(event) => setStart(event.target.value)} />
              </Field>
            </div>
            <Field id="shift-supervisor" label="Supervisor">
              <MillSelect id="shift-supervisor" value={supervisorId} onChange={setSupervisorId} allowNone options={(people.data?.users ?? []).map((user) => ({ value: user.id, label: user.name }))} />
            </Field>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {(people.data?.employees ?? []).map((employee) => {
                const on = employee.id in crew;
                return (
                  <div key={employee.id} className="grid grid-cols-[1fr_12rem] items-center gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={on}
                        onCheckedChange={(checked) =>
                          setCrew((current) => {
                            const next = { ...current };
                            if (checked === true) next[employee.id] = "";
                            else delete next[employee.id];
                            return next;
                          })
                        }
                      />
                      {employee.name} <span className="text-xs text-muted-foreground">{employee.jobTitle ?? employee.employeeId}</span>
                    </label>
                    {on ? (
                      <MillSelect value={crew[employee.id]} onChange={(dutyId) => setCrew((current) => ({ ...current, [employee.id]: dutyId }))} placeholder="Duty" allowNone options={activeDuties.map((duty) => ({ value: duty.id, label: duty.name }))} />
                    ) : (
                      <span />
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-sm text-muted-foreground">{Object.keys(crew).length} on the crew.</p>
            <FormError error={plan.error} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={plan.pending}
              onClick={() =>
                plan.post("/api/milling/shifts", {
                  date,
                  kind,
                  startTime: start,
                  supervisorId: supervisorId || null,
                  crew: Object.entries(crew).map(([employeeId, dutyId]) => ({ employeeId, dutyId: dutyId || null })),
                })
              }
            >
              Plan shift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
