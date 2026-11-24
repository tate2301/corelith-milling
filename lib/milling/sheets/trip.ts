import { z } from "zod";

import { fetchJson } from "@/lib/api-client";
import type { SheetKind, SheetValues } from "@/lib/workspace/sheet-kind";

import { idOf, labels, numberOf, text, type Choice } from "./choices";
import { slotFields, slotItems } from "./slots";

type Detail = {
  delivery: { id: string; code: string; status: string; odometerOut: string | number | null };
  lines: Array<{ id: string; order: string; customer: string; product: string; bags: number }>;
};

const STOP_SLOTS = 40;
const whole = z.string().regex(/^\d+$/, "A whole number of bags.");
const reading = z.string().regex(/^\d+(\.\d)?$/, "The odometer, in kilometres.");
const detail = (id: string | null) => fetchJson<Detail>(`/api/milling/deliveries/${id}`);
const post = (id: string | null, action: string, body: unknown) => ({ method: "POST" as const, url: `/api/milling/deliveries/${id}/${action}`, body });

/** Load an order onto the trip (DS-C1): a confirmed order's reserved bags, oldest lots first. */
const load: SheetKind = {
  title: (_ctx, values) => `Load onto ${String(values._code ?? "the trip")}`,
  sub: "A confirmed order's reserved bags go on, oldest lots first. The load is checked against the truck.",
  cur: "US$",
  load: async (ctx) => {
    const [trip, orders] = await Promise.all([
      detail(ctx.id),
      fetchJson<{ rows: Array<{ id: string; code: string; customer: string; bags: number }> }>("/api/milling/customer-orders?status=CONFIRMED"),
    ]);
    const _order: Choice[] = orders.rows.map((row) => ({ id: row.id, label: `${row.code} · ${row.customer} · ${row.bags} bags` }));
    return { _code: trip.delivery.code, _order, order: _order[0]?.label ?? "" };
  },
  sections: [{ fields: [{ id: "order", t: "text", l: "Order", o: (values) => labels(values, "order"), needed: "Choose the order to load.", h: "Only confirmed orders, whose bags are reserved." }] }],
  note: "",
  primary: "Load",
  done: "Order loaded",
  submit: (values, ctx) => post(ctx.id, "load", { orderId: idOf(values, "order") }),
  invalidate: [["list"], ["reports"], ["milling"], ["milling-trip"]],
  requires: [["ext:milling", "delivery.manage"]],
};

/** Dispatch (DS-C1): the truck leaves with its odometer reading. Stock comes off as it leaves. */
const dispatch: SheetKind = {
  title: (_ctx, values) => `Dispatch ${String(values._code ?? "")}`.trim(),
  sub: "Stock comes off as the truck leaves. A load over its capacity, or a truck not released, stops it here.",
  cur: "US$",
  load: async (ctx) => {
    const trip = await detail(ctx.id);
    return { _code: trip.delivery.code, odometer: "" };
  },
  sections: [{ fields: [{ id: "odometer", t: "text", l: "Odometer out, km", mono: true, right: true, inputMode: "decimal", needed: "Read the odometer as it leaves.", schema: reading }] }],
  note: "",
  primary: "Dispatch",
  done: (_result, values) => `${String(values._code ?? "Trip")} is on the road`,
  submit: (values, ctx) => post(ctx.id, "dispatch", { odometerOut: text(values.odometer) }),
  invalidate: [["list"], ["reports"], ["milling"], ["milling-trip"]],
  requires: [["ext:milling", "delivery.manage"]],
};

/** Record the delivery (PH-F1, PH-F2): each stop's bags delivered, damaged and returned, and who received them. */
const proof: SheetKind = {
  title: "Record the delivery",
  sub: "Bags not delivered, damaged or returned raise a shortage for management; returned bags come back on hold.",
  wide: true,
  cur: "US$",
  load: async (ctx) => {
    const trip = await detail(ctx.id);
    return {
      _stops: trip.lines.slice(0, STOP_SLOTS).map((line) => ({ id: line.id, name: `${line.order} · ${line.customer}`, sub: `${line.product}, ${line.bags} loaded` })),
      ...Object.fromEntries(trip.lines.slice(0, STOP_SLOTS).flatMap((line, index) => [[`delivered${index}`, String(line.bags)], [`damaged${index}`, "0"], [`returned${index}`, "0"]])),
      receivedBy: "",
    };
  },
  sections: [
    {
      title: "Stops",
      fields: slotFields("stops", STOP_SLOTS, (index, item) => [
        { id: `delivered${index}`, t: "text", l: "", lw: (values) => `${item(values)?.name ?? ""}: delivered of ${item(values)?.sub ?? ""}`, mono: true, right: true, inputMode: "numeric", schema: whole },
        { id: `damaged${index}`, t: "text", l: "Damaged", half: true, mono: true, right: true, inputMode: "numeric", schema: whole },
        { id: `returned${index}`, t: "text", l: "Returned", half: true, mono: true, right: true, inputMode: "numeric", schema: whole },
      ]),
    },
    { fields: [{ id: "receivedBy", t: "text", l: "Received by", p: "Name and role", needed: "Who received it?" }] },
  ],
  note: "",
  primary: "Save the delivery",
  done: "Delivery recorded",
  submit: (values, ctx) => ({
    ...post(ctx.id, "proof", {
      receivedBy: text(values.receivedBy),
      lines: slotItems(values, "stops").map((stop, index) => ({
        lineId: stop.id,
        deliveredBags: numberOf(values[`delivered${index}`]) ?? 0,
        damagedBags: numberOf(values[`damaged${index}`]) ?? 0,
        returnedBags: numberOf(values[`returned${index}`]) ?? 0,
      })),
    }),
  }),
  invalidate: [["list"], ["reports"], ["milling"], ["milling-trip"]],
  requires: [
    ["ext:milling", "delivery.manage"],
    ["ext:milling", "delivery.own"],
  ],
};

/** Close the trip (PH-G1): the odometer back and the fuel used. Its fuel posts to Books. */
const close: SheetKind = {
  title: (_ctx, values) => `Close ${String(values._code ?? "the trip")}`,
  sub: (_ctx, values) => (values._out ? `It left at ${String(values._out)} km.` : "The odometer back and the fuel it used."),
  cur: "US$",
  load: async (ctx) => {
    const trip = await detail(ctx.id);
    return { _code: trip.delivery.code, _out: trip.delivery.odometerOut === null ? "" : String(trip.delivery.odometerOut), odometer: "", fuel: "" };
  },
  sections: [
    {
      fields: [
        { id: "odometer", t: "text", l: "Odometer back, km", half: true, mono: true, right: true, inputMode: "decimal", needed: "Read the odometer.", schema: reading },
        { id: "fuel", t: "text", l: "Fuel, litres", half: true, mono: true, right: true, inputMode: "decimal", opt: true },
      ],
    },
  ],
  note: (values: SheetValues) => {
    const out = numberOf(values._out);
    const back = numberOf(values.odometer);
    return out !== null && back !== null && back > out ? `${(back - out).toLocaleString("en-GB")} km on this trip.` : "";
  },
  primary: "Close the trip",
  done: (_result, values) => `${String(values._code ?? "Trip")} closed`,
  submit: (values, ctx) => post(ctx.id, "close", { odometerIn: text(values.odometer), fuelLitres: text(values.fuel) || null }),
  invalidate: [["list"], ["reports"], ["milling"], ["milling-trip"]],
  requires: [["ext:milling", "delivery.manage"]],
};

export const TRIP_SHEETS: Record<string, SheetKind> = {
  "mill-trip-load": load,
  "mill-trip-dispatch": dispatch,
  "mill-trip-proof": proof,
  "mill-trip-close": close,
};
