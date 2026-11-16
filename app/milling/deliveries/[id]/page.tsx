"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { Field, FormError, Stat } from "@/components/milling/form-bits";
import { formatKg, formatWhen, MillSelect, MillStatus } from "@/components/milling/mill-ui";
import { RecordHistory } from "@/components/milling/record-history";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { useMillPost } from "@/components/milling/use-mill-post";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { SectionTab, SectionTabs } from "@/components/ui/section-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/api-client";

type Line = { id: string; orderId: string; order: string; customer: string; product: string; lot: string; bags: number; deliveredBags: number | null; shortBags: number; damagedBags: number; returnedBags: number };
type Detail = {
  delivery: { id: string; code: string; status: string; dispatchedAt: string | null; deliveredAt: string | null; odometerOut: number | null; odometerIn: number | null; fuelLitres: number | null; receivedBy: string | null };
  vehicle: { equipmentCode: string; name: string } | null;
  driver: string | null;
  destination: string | null;
  load: { loadKg: number; capacityKg: number | null; vehicleAvailable: boolean };
  lines: Line[];
  exceptions: Array<{ id: string; code: string; title: string; status: string }>;
};

/** One trip: what is on the truck against its capacity, dispatch, proof of delivery, and reconciliation. */
export default function DeliveryPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<"trip" | "history">("trip");
  const query = useQuery({ queryKey: ["milling", "delivery", id], queryFn: () => fetchJson<Detail>(`/api/milling/deliveries/${id}`) });
  if (query.isPending || !query.data) return <Skeleton className="m-4 h-96" />;
  const { delivery } = query.data;
  return (
    <>
      <PageChrome title={`Delivery ${delivery.code}`} />
      <div className="space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <MillStatus status={delivery.status} />
          <span className="text-sm text-muted-foreground">
            {query.data.vehicle ? `${query.data.vehicle.name}` : ""}
            {query.data.driver ? ` · ${query.data.driver}` : ""}
            {query.data.destination ? ` · to ${query.data.destination}` : ""}
            {" · "}
            <Link className="underline" href={`/milling/trace?code=${encodeURIComponent(delivery.code)}`}>
              Trace
            </Link>
          </span>
        </div>
        <SectionTabs label="Delivery sections">
          <SectionTab onClick={() => setTab("trip")} active={tab === "trip"}>
            Trip
          </SectionTab>
          <SectionTab onClick={() => setTab("history")} active={tab === "history"}>
            History
          </SectionTab>
        </SectionTabs>
        {tab === "history" ? <RecordHistory entityType="MillingDelivery" entityId={delivery.id} /> : <Trip detail={query.data} />}
      </div>
    </>
  );
}

function Trip({ detail }: { detail: Detail }) {
  const { delivery, load, lines, exceptions } = detail;
  const access = useMillAccess();
  const manage = access.can("delivery.manage");
  const act = useMillPost({ done: "Saved" });
  const [odometer, setOdometer] = useState("");
  const [fuel, setFuel] = useState("");
  const over = load.capacityKg !== null && load.loadKg > load.capacityKg;
  const open = exceptions.filter((exception) => exception.status === "OPEN");
  const orders = [...new Map(lines.map((line) => [line.orderId, line])).values()];

  return (
    <div className="space-y-8">
      {open.length ? (
        <Alert variant="warning">
          <AlertTitle>Waiting for a decision</AlertTitle>
          <AlertDescription>
            {open.map((exception) => `${exception.code}: ${exception.title}`).join("; ")}.{" "}
            <Link className="underline" href="/milling/exceptions">
              Open the exceptions queue
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="max-w-xl space-y-2">
        <div className="flex justify-between text-sm">
          <span>Load</span>
          <span className="font-mono">
            {formatKg(load.loadKg)} {load.capacityKg ? `of ${formatKg(load.capacityKg)}` : "(no capacity set for this truck)"}
          </span>
        </div>
        {load.capacityKg ? <Progress value={Math.min(100, (load.loadKg / load.capacityKg) * 100)} aria-label="Load against capacity" /> : null}
        {over ? <p className="text-sm">Over capacity by {formatKg(load.loadKg - load.capacityKg!)}. Take an order off before it leaves.</p> : null}
        {!load.vehicleAvailable ? <p className="text-sm">The truck is not released for work.</p> : null}
      </section>

      <Table hideControlsWhenSinglePage>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Lot</TableHead>
            <TableHead className="text-right">Loaded</TableHead>
            <TableHead className="text-right">Delivered</TableHead>
            <TableHead className="text-right">Short</TableHead>
            <TableHead className="text-right">Damaged</TableHead>
            <TableHead className="text-right">Returned</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.id}>
              <TableCell className="whitespace-nowrap font-mono">{line.order}</TableCell>
              <TableCell>{line.customer}</TableCell>
              <TableCell>{line.product}</TableCell>
              <TableCell className="whitespace-nowrap font-mono">
                <Link className="underline" href={`/milling/trace?code=${encodeURIComponent(line.lot)}`}>
                  {line.lot}
                </Link>
              </TableCell>
              <TableCell className="text-right font-mono">{line.bags}</TableCell>
              <TableCell className="text-right font-mono">{line.deliveredBags ?? "—"}</TableCell>
              <TableCell className="text-right font-mono">{line.shortBags || "—"}</TableCell>
              <TableCell className="text-right font-mono">{line.damagedBags || "—"}</TableCell>
              <TableCell className="text-right font-mono">{line.returnedBags || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {["PLANNED", "LOADING"].includes(delivery.status) && manage ? (
        <section className="space-y-3">
          <LoadOrders deliveryId={delivery.id} />
          {orders.length ? (
            <div className="flex flex-wrap gap-2">
              {orders.map((line) => (
                <Button key={line.orderId} size="sm" variant="ghost" onClick={() => act.post(`/api/milling/deliveries/${delivery.id}/unload`, { orderId: line.orderId })}>
                  Take {line.order} off
                </Button>
              ))}
            </div>
          ) : null}
          <div className="flex max-w-xl flex-wrap items-end gap-3">
            <Field id="odo-out" label="Odometer out">
              <Input id="odo-out" className="w-40 font-mono" inputMode="decimal" value={odometer} onChange={(event) => setOdometer(event.target.value)} />
            </Field>
            <Button disabled={act.pending || !lines.length} onClick={() => act.post(`/api/milling/deliveries/${delivery.id}/dispatch`, { odometerOut: odometer })}>
              Dispatch
            </Button>
          </div>
        </section>
      ) : null}

      {delivery.status === "DISPATCHED" ? <Proof detail={detail} /> : null}

      {delivery.status === "DELIVERED" && manage ? (
        <section className="flex max-w-xl flex-wrap items-end gap-3">
          <Field id="odo-in" label="Odometer back">
            <Input id="odo-in" className="w-40 font-mono" inputMode="decimal" value={odometer} onChange={(event) => setOdometer(event.target.value)} />
          </Field>
          <Field id="fuel" label="Fuel (litres)">
            <Input id="fuel" className="w-32 font-mono" inputMode="decimal" value={fuel} onChange={(event) => setFuel(event.target.value)} />
          </Field>
          <Button disabled={act.pending} onClick={() => act.post(`/api/milling/deliveries/${delivery.id}/close`, { odometerIn: odometer, fuelLitres: fuel })}>
            Close the delivery
          </Button>
        </section>
      ) : null}
      <FormError error={act.error} />

      {["DELIVERED", "CLOSED"].includes(delivery.status) ? (
        <dl className="grid gap-4 text-sm sm:grid-cols-4">
          <Stat label="Received by">{delivery.receivedBy ?? "—"}</Stat>
          <Stat label="Delivered">{formatWhen(delivery.deliveredAt)}</Stat>
          <Stat label="Distance">
            <span className="font-mono">{delivery.odometerIn && delivery.odometerOut ? `${(Number(delivery.odometerIn) - Number(delivery.odometerOut)).toFixed(0)} km` : "—"}</span>
          </Stat>
          <Stat label="Fuel">
            <span className="font-mono">{delivery.fuelLitres ? `${delivery.fuelLitres} L` : "—"}</span>
          </Stat>
        </dl>
      ) : null}
    </div>
  );
}

function LoadOrders({ deliveryId }: { deliveryId: string }) {
  const confirmed = useQuery({ queryKey: ["milling", "customer-orders", "CONFIRMED"], queryFn: () => fetchJson<{ rows: Array<{ id: string; code: string; customer: string; destination: string | null; bags: number; kg: number }> }>("/api/milling/customer-orders?status=CONFIRMED") });
  const [orderId, setOrderId] = useState("");
  const load = useMillPost({ done: "Loaded", onDone: () => setOrderId("") });
  return (
    <div className="flex max-w-xl flex-wrap items-end gap-3">
      <div className="min-w-64 flex-1">
        <MillSelect value={orderId} onChange={setOrderId} placeholder="A confirmed order" options={(confirmed.data?.rows ?? []).map((order) => ({ value: order.id, label: `${order.code} · ${order.customer}${order.destination ? ` · ${order.destination}` : ""} · ${order.bags} bags, ${formatKg(order.kg)}` }))} />
      </div>
      <Button variant="secondary" disabled={!orderId || load.pending} onClick={() => load.post(`/api/milling/deliveries/${deliveryId}/load`, { orderId })}>
        Load it
      </Button>
      <FormError error={load.error} />
    </div>
  );
}

/** The driver's proof of delivery, made for a phone: what was delivered, damaged and returned, and who took it. */
function Proof({ detail }: { detail: Detail }) {
  const access = useMillAccess();
  const save = useMillPost({ done: "Proof of delivery saved" });
  const [counts, setCounts] = useState<Record<string, { delivered: string; damaged: string; returned: string }>>(() =>
    Object.fromEntries(detail.lines.map((line) => [line.id, { delivered: String(line.bags), damaged: "0", returned: "0" }])),
  );
  const [receivedBy, setReceivedBy] = useState("");
  const [where, setWhere] = useState<{ latitude: number; longitude: number } | null>(null);
  if (!access.can("delivery.manage") && !access.can("delivery.own")) return null;
  const set = (lineId: string, key: "delivered" | "damaged" | "returned", value: string) => setCounts((current) => ({ ...current, [lineId]: { ...current[lineId], [key]: value } }));
  return (
    <section className="max-w-xl space-y-4">
      <h2 className="text-base font-semibold">Proof of delivery</h2>
      {detail.lines.map((line) => (
        <div key={line.id} className="space-y-2 rounded-md border p-3">
          <div className="text-sm">
            <span className="font-medium">{line.customer}</span> · {line.product} · {line.bags} loaded
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["delivered", "damaged", "returned"] as const).map((key) => (
              <Field key={key} id={`${line.id}-${key}`} label={key === "delivered" ? "Delivered" : key === "damaged" ? "Damaged" : "Returned"}>
                <Input id={`${line.id}-${key}`} className="font-mono" inputMode="numeric" value={counts[line.id][key]} onChange={(event) => set(line.id, key, event.target.value)} />
              </Field>
            ))}
          </div>
        </div>
      ))}
      <Field id="received-by" label="Received by">
        <Input id="received-by" value={receivedBy} onChange={(event) => setReceivedBy(event.target.value)} placeholder="Name and role" />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          onClick={() => navigator.geolocation?.getCurrentPosition((position) => setWhere({ latitude: position.coords.latitude, longitude: position.coords.longitude }))}
        >
          {where ? "Location recorded" : "Record where I am"}
        </Button>
        {where ? <span className="font-mono text-xs">{where.latitude.toFixed(5)}, {where.longitude.toFixed(5)}</span> : null}
      </div>
      <FormError error={save.error} />
      <Button
        disabled={save.pending}
        onClick={() =>
          save.post(`/api/milling/deliveries/${detail.delivery.id}/proof`, {
            receivedBy,
            ...(where ?? {}),
            lines: detail.lines.map((line) => ({
              lineId: line.id,
              deliveredBags: counts[line.id].delivered,
              damagedBags: counts[line.id].damaged,
              returnedBags: counts[line.id].returned,
            })),
          })
        }
      >
        Save proof of delivery
      </Button>
    </section>
  );
}
