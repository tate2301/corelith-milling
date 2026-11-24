import { fetchJson } from "@/lib/api-client";
import type { HistoryEntry } from "@/lib/milling/records/history";
import type { Grant, RailGroup, RecordAction, RecordKind, RecordStep } from "@/lib/retail/record-kinds/types";

import { historyRail } from "./shared";

type Line = { id: string; orderId: string; order: string; customer: string; bags: number; deliveredBags: number | null; shortBags: number; damagedBags: number; returnedBags: number };
type Exception = { id: string; code: string; title: string; status: string };

export type TripView = {
  delivery: {
    id: string;
    code: string;
    status: string;
    odometerOut: string | number | null;
    odometerIn: string | number | null;
    fuelLitres: string | number | null;
    dispatchedAt: string | null;
    deliveredAt: string | null;
    closedAt: string | null;
    createdAt: string;
    receivedBy: string | null;
  };
  vehicle: { equipmentCode: string; name: string } | null;
  driver: string | null;
  destination: string | null;
  load: { loadKg: number; capacityKg: number | null; vehicleAvailable: boolean };
  lines: Line[];
  exceptions: Exception[];
  history: HistoryEntry[];
};

const MANAGE: Grant = ["ext:milling", "delivery.manage"];
const DRIVE: Grant = ["ext:milling", "delivery.own"];
const ORDER = ["PLANNED", "LOADING", "DISPATCHED", "DELIVERED", "CLOSED"];
const STEP_LABEL: Record<string, string> = { PLANNED: "Planned", LOADING: "Loading", DISPATCHED: "Out", DELIVERED: "Delivered", CLOSED: "Closed" };
const STATE_TONE: Record<string, "plain" | "info" | "warn" | "ok"> = { PLANNED: "plain", LOADING: "info", DISPATCHED: "info", DELIVERED: "warn", CLOSED: "ok", CANCELLED: "plain" };

const kg = (value: number) => `${value.toLocaleString("en-GB", { maximumFractionDigits: 0 })} kg`;
const num = (value: string | number | null) => (value === null || value === "" ? null : Number(value));
const when = (value: string | null) =>
  value ? new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Harare", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

function steps(trip: TripView): RecordStep[] {
  const at = ORDER.indexOf(trip.delivery.status);
  return ORDER.map((status, index) => ({ label: STEP_LABEL[status]!, state: index < at ? "done" : index === at ? "now" : "todo" }));
}

function primary(trip: TripView): RecordAction | null {
  const id = trip.delivery.id;
  switch (trip.delivery.status) {
    case "PLANNED":
    case "LOADING":
      return trip.lines.length
        ? { key: "dispatch", label: "Dispatch", requires: [MANAGE], disabled: trip.load.capacityKg !== null && trip.load.loadKg > trip.load.capacityKg ? "Over the truck's capacity: take an order off first." : undefined, do: { sheet: "mill-trip-dispatch", id } }
        : { key: "load", label: "Load an order", requires: [MANAGE], do: { sheet: "mill-trip-load", id } };
    case "DISPATCHED":
      return { key: "proof", label: "Record the delivery", requires: [MANAGE, DRIVE], do: { sheet: "mill-trip-proof", id } };
    case "DELIVERED":
      return { key: "close", label: "Close the trip", requires: [MANAGE], do: { sheet: "mill-trip-close", id } };
    default:
      return null;
  }
}

function actions(trip: TripView): RecordAction[] {
  const id = trip.delivery.id;
  if (!["PLANNED", "LOADING"].includes(trip.delivery.status) || !trip.lines.length) return [];
  return [{ key: "load", label: "Load an order", requires: [MANAGE], do: { sheet: "mill-trip-load", id } }];
}

function more(trip: TripView): RecordAction[] {
  if (!["PLANNED", "LOADING"].includes(trip.delivery.status)) return [];
  const orders = [...new Map(trip.lines.map((line) => [line.orderId, line])).values()];
  return orders.map((line) => ({
    key: `unload-${line.orderId}`,
    label: `Take ${line.order} off`,
    sub: line.customer,
    requires: [MANAGE],
    do: { post: { url: `/api/milling/deliveries/${trip.delivery.id}/unload`, body: { orderId: line.orderId }, done: `${line.order} taken off` } },
  }));
}

function rail(trip: TripView): RailGroup[] {
  const out = num(trip.delivery.odometerOut);
  const back = num(trip.delivery.odometerIn);
  return [
    {
      title: "Trip",
      rows: [
        { key: "truck", label: "Truck", value: trip.vehicle ? `${trip.vehicle.equipmentCode} ${trip.vehicle.name}` : "—", mono: true },
        { key: "driver", label: "Driver", value: trip.driver ?? "None yet", muted: !trip.driver },
        { key: "destination", label: "Destination", value: trip.destination ?? "None", muted: !trip.destination },
        { key: "left", label: "Left", value: when(trip.delivery.dispatchedAt), mono: true },
        { key: "back", label: "Closed", value: when(trip.delivery.closedAt), mono: true },
        { key: "received", label: "Received by", value: trip.delivery.receivedBy ?? "—", muted: !trip.delivery.receivedBy },
      ],
    },
    {
      title: "Load",
      rows: [
        { key: "load", label: "Loaded", value: kg(trip.load.loadKg), mono: true, warn: trip.load.capacityKg !== null && trip.load.loadKg > trip.load.capacityKg ? `Over capacity by ${kg(trip.load.loadKg - trip.load.capacityKg)}.` : undefined },
        { key: "capacity", label: "Truck takes", value: trip.load.capacityKg === null ? "No capacity set" : kg(trip.load.capacityKg), mono: true, muted: trip.load.capacityKg === null },
        { key: "odometer", label: "Odometer", value: out === null ? "—" : back === null ? `${out.toLocaleString("en-GB")} out` : `${out.toLocaleString("en-GB")} to ${back.toLocaleString("en-GB")}`, mono: true },
      ],
    },
    historyRail(trip.history),
  ];
}

/**
 * A trip (canvas DS-A2) on core's RecordFrame: its route and truck, where it
 * is, its stops with what each delivered, and its history. What comes next
 * (dispatch, record the delivery, close) is the primary, opening its sheet.
 */
export const tripKind: RecordKind<TripView> = {
  type: "MillingDelivery",
  back: { label: "Despatches", href: "/milling/deliveries" },
  queryKey: (id) => ["milling-trip", id],
  load: async (id) => {
    const [detail, history] = await Promise.all([
      fetchJson<Omit<TripView, "history">>(`/api/milling/deliveries/${id}`),
      fetchJson<HistoryEntry[]>(`/api/milling/history?entityType=MillingDelivery&entityId=${id}`).catch(() => []),
    ]);
    return { ...detail, history };
  },
  title: (trip) => [trip.destination, trip.vehicle?.name].filter(Boolean).join(", ") || trip.delivery.code,
  reference: (trip) => trip.delivery.code,
  primary,
  actions,
  more,
  banner: (trip) => {
    const open = trip.exceptions.filter((exception) => exception.status === "OPEN");
    if (open.length) return { lead: `${open[0]!.title}.`, text: open.length > 1 ? `${open.length} exceptions wait for management under Exceptions.` : "It waits for management under Exceptions." };
    if (!trip.load.vehicleAvailable && ["PLANNED", "LOADING"].includes(trip.delivery.status)) return { lead: "The truck is not released for work.", text: "Maintenance releases it before it can leave.", tone: "bad" };
    return null;
  },
  steps: (trip) => (trip.delivery.status === "CANCELLED" ? [] : steps(trip)),
  chips: (trip) => [{ label: STEP_LABEL[trip.delivery.status] ?? "Cancelled", tone: STATE_TONE[trip.delivery.status] ?? "plain" }],
  figure: (trip) => {
    const out = num(trip.delivery.odometerOut);
    const back = num(trip.delivery.odometerIn);
    return out !== null && back !== null ? { label: "Distance", value: `${(back - out).toLocaleString("en-GB")} km` } : { label: "Load", value: kg(trip.load.loadKg) };
  },
  kpis: (trip) => {
    const loaded = trip.lines.reduce((sum, line) => sum + line.bags, 0);
    const delivered = trip.lines.reduce((sum, line) => sum + (line.deliveredBags ?? 0), 0);
    const short = trip.lines.reduce((sum, line) => sum + line.shortBags + line.damagedBags, 0);
    const out = num(trip.delivery.odometerOut);
    const back = num(trip.delivery.odometerIn);
    const fuel = num(trip.delivery.fuelLitres);
    const km = out !== null && back !== null ? back - out : null;
    return [
      { label: "Odometer", value: out === null ? "—" : back === null ? `${out.toLocaleString("en-GB")}` : `${out.toLocaleString("en-GB")} to ${back.toLocaleString("en-GB")}`, note: back === null ? "Out" : "Out to back" },
      { label: "Fuel", value: fuel === null ? "—" : `${fuel} L`, note: km && fuel ? `${(km / fuel).toFixed(2)} km a litre` : "Recorded when it closes" },
      { label: "Delivered", value: `${delivered.toLocaleString("en-GB")} bags`, note: `of ${loaded.toLocaleString("en-GB")} loaded` },
      { label: "Short or damaged", value: `${short.toLocaleString("en-GB")} bags`, ...(short ? { lead: "Shortage", leadTone: "warn" as const } : {}), note: short ? "raised for management" : "Nothing short" },
    ];
  },
  tabs: [{ key: "stops", label: "Stops", source: "milling-delivery-lines", parent: "delivery" }],
  rail,
  invalidates: [["list"], ["reports"], ["milling"]],
};
