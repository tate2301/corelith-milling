"use client";

import { useState } from "react";

import { Field, FormError } from "@/components/milling/form-bits";
import { MillSelect } from "@/components/milling/mill-ui";
import { useMillPost } from "@/components/milling/use-mill-post";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type RouteFormVehicle = { id: string; name: string; equipmentCode: string };
type Existing = { id: string; code: string; name: string; visitDays: number[]; vehicleId: string | null; isActive: boolean };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A route's code, name, visit days and usual vehicle: new, or changed. */
export function RouteForm({ vehicles, route, label, onSaved }: { vehicles: RouteFormVehicle[]; route?: Existing; label: string; onSaved?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(route?.code ?? "");
  const [name, setName] = useState(route?.name ?? "");
  const [days, setDays] = useState<number[]>(route?.visitDays ?? []);
  const [vehicleId, setVehicle] = useState(route?.vehicleId ?? "");
  const [isActive, setActive] = useState(route?.isActive ?? true);
  const save = useMillPost<{ id: string }>({ done: "Route saved", onDone: (saved) => (setOpen(false), onSaved?.(saved.id)) });
  return (
    <>
      <Button variant={route ? "secondary" : "default"} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{route ? `Edit ${route.code}` : "New route"}</DialogTitle>
            <DialogDescription className="not-sr-only t-body-sm text-[var(--text-muted)]">Customers are put on the route, in order, from the route&apos;s own page.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-[8rem_1fr] gap-3">
              <Field id="rt-code" label="Code">
                <Input id="rt-code" className="font-mono" value={code} placeholder="RT-05" onChange={(event) => setCode(event.target.value)} />
              </Field>
              <Field id="rt-name" label="Name">
                <Input id="rt-name" value={name} placeholder="Nyabira" onChange={(event) => setName(event.target.value)} />
              </Field>
            </div>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Visit days</legend>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((label, index) => {
                  const value = index + 1;
                  const on = days.includes(value);
                  return (
                    <Button key={label} type="button" size="sm" variant={on ? "default" : "secondary"} aria-pressed={on} onClick={() => setDays((current) => (on ? current.filter((day) => day !== value) : [...current, value].sort()))}>
                      {label}
                    </Button>
                  );
                })}
              </div>
            </fieldset>
            <Field id="rt-vehicle" label="Usual vehicle">
              <MillSelect id="rt-vehicle" value={vehicleId} onChange={setVehicle} allowNone placeholder="None" options={vehicles.map((vehicle) => ({ value: vehicle.id, label: `${vehicle.name} (${vehicle.equipmentCode})` }))} />
            </Field>
            {route ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={isActive} onChange={(event) => setActive(event.target.checked)} />
                Running
              </label>
            ) : null}
            <FormError error={save.error} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={save.pending} onClick={() => save.post(route ? `/api/milling/routes/${route.id}` : "/api/milling/routes", { code, name, visitDays: days, vehicleId: vehicleId || null, isActive })}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
