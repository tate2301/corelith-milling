"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { Field, FormError } from "@/components/milling/form-bits";
import { formatKg, formatWhen, MillSelect, MillStatus, useMillLookups } from "@/components/milling/mill-ui";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { useMillPost } from "@/components/milling/use-mill-post";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionTab, SectionTabs } from "@/components/ui/section-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/api-client";

type Delivery = { id: string; code: string; status: string; createdAt: string; dispatchedAt: string | null; loadKg: number; bags: number; orders: number; driver: string | null; destination: string | null; vehicle: { equipmentCode: string; name: string } | null };

const TABS = [
  { status: "ACTIVE", label: "Planned and loading" },
  { status: "DISPATCHED", label: "On the road" },
  { status: "DELIVERED", label: "Awaiting reconciliation" },
  { status: "CLOSED", label: "Closed" },
] as const;

/** Trips: planned, loading, on the road, back and waiting to be reconciled, and closed. A driver sees their own. */
export default function MillDeliveriesPage() {
  const params = useSearchParams();
  const router = useRouter();
  const access = useMillAccess();
  const status = params.get("status") ?? (access.can("delivery.manage") ? "ACTIVE" : "DISPATCHED");
  const query = useQuery({ queryKey: ["milling", "deliveries", status], queryFn: () => fetchJson<{ rows: Delivery[]; counts: Record<string, number> }>(`/api/milling/deliveries?status=${status}`) });
  const count = (tab: string) => (tab === "ACTIVE" ? (query.data?.counts.PLANNED ?? 0) + (query.data?.counts.LOADING ?? 0) : query.data?.counts[tab]);
  return (
    <>
      <PageChrome title="Deliveries" />
      <div className="space-y-4 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTabs label="Deliveries by status">
            {TABS.map((tab) => (
              <SectionTab key={tab.status} to={`/milling/deliveries?status=${tab.status}`} active={status === tab.status} count={count(tab.status) || undefined}>
                {tab.label}
              </SectionTab>
            ))}
          </SectionTabs>
          {access.can("delivery.manage") ? <PlanDelivery onPlanned={(id) => router.push(`/milling/deliveries/${id}`)} /> : null}
        </div>
        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : !query.data?.rows.length ? (
          <EmptyState title="No deliveries here" body="Plan a trip, load confirmed orders onto it, and dispatch it." />
        ) : (
          <Table hideControlsWhenSinglePage>
            <TableHeader>
              <TableRow>
                <TableHead>Delivery</TableHead>
                <TableHead>Truck</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Bags</TableHead>
                <TableHead className="text-right">Load</TableHead>
                <TableHead>Left</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.rows.map((delivery) => (
                <TableRow key={delivery.id} className="cursor-pointer" onClick={() => router.push(`/milling/deliveries/${delivery.id}`)}>
                  <TableCell className="font-mono">{delivery.code}</TableCell>
                  <TableCell>{delivery.vehicle ? `${delivery.vehicle.equipmentCode} ${delivery.vehicle.name}` : "—"}</TableCell>
                  <TableCell>{delivery.driver ?? "—"}</TableCell>
                  <TableCell>{delivery.destination ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{delivery.orders}</TableCell>
                  <TableCell className="text-right font-mono">{delivery.bags}</TableCell>
                  <TableCell className="text-right font-mono">{formatKg(Number(delivery.loadKg))}</TableCell>
                  <TableCell>{formatWhen(delivery.dispatchedAt)}</TableCell>
                  <TableCell>
                    <MillStatus status={delivery.status} />
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

function PlanDelivery({ onPlanned }: { onPlanned: (id: string) => void }) {
  const lookups = useMillLookups();
  const [open, setOpen] = useState(false);
  const people = useQuery({ queryKey: ["milling", "people"], queryFn: () => fetchJson<{ users: Array<{ id: string; name: string }> }>("/api/milling/people"), enabled: open });
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const plan = useMillPost<{ id: string }>({ onDone: (delivery) => onPlanned(delivery.id) });
  return (
    <>
      <Button onClick={() => setOpen(true)}>Plan a delivery</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Plan a delivery</DialogTitle>
            <DialogDescription>Choose the truck and driver; load orders onto it next.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field id="dn-vehicle" label="Truck">
              <MillSelect
                id="dn-vehicle"
                value={vehicleId}
                onChange={(id) => {
                  setVehicleId(id);
                  const usual = lookups.data?.vehicles.find((vehicle) => vehicle.id === id)?.driverUserId;
                  if (usual && !driverId) setDriverId(usual);
                }}
                options={(lookups.data?.vehicles ?? []).map((vehicle) => ({ value: vehicle.id, label: `${vehicle.name}${vehicle.registrationNumber ? ` · ${vehicle.registrationNumber}` : ""}${vehicle.capacityKg ? ` · up to ${formatKg(vehicle.capacityKg)}` : ""}` }))}
              />
            </Field>
            <Field id="dn-driver" label="Driver">
              <MillSelect id="dn-driver" value={driverId} onChange={setDriverId} allowNone options={(people.data?.users ?? []).map((user) => ({ value: user.id, label: user.name }))} />
            </Field>
            <Field id="dn-dest" label="Destination">
              <MillSelect id="dn-dest" value={destinationId} onChange={setDestinationId} allowNone options={(lookups.data?.destinations ?? []).map((destination) => ({ value: destination.id, label: destination.name }))} />
            </Field>
            <FormError error={plan.error} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={plan.pending} onClick={() => plan.post("/api/milling/deliveries", { vehicleId, driverId: driverId || null, destinationId: destinationId || null })}>
              Plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
