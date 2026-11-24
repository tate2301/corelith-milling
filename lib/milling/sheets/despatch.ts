import type { MillLookups } from "@/components/milling/mill-ui";
import { fetchJson } from "@/lib/api-client";
import type { SheetKind, SheetValues } from "@/lib/workspace/sheet-kind";

import { idOf, labels, type Choice } from "./choices";
import { slotFields, slotItems } from "./slots";

/** New despatch note (DS-A1): the truck, its driver and where it goes. Orders are loaded onto it next, on the note. */
const despatchNew: SheetKind = {
  title: "New despatch note",
  sub: "Choose the truck and driver; load orders onto it next.",
  cur: "US$",
  load: async () => {
    const [lookups, people] = await Promise.all([fetchJson<MillLookups>("/api/milling/lookups"), fetchJson<{ users: Array<{ id: string; name: string }> }>("/api/milling/people")]);
    const _truck: Choice[] = lookups.vehicles.map((vehicle) => ({
      id: vehicle.id,
      label: `${vehicle.name}${vehicle.registrationNumber ? ` · ${vehicle.registrationNumber}` : ""}${vehicle.capacityKg ? ` · up to ${vehicle.capacityKg.toLocaleString("en-GB")} kg` : ""}`,
    }));
    const _driver: Choice[] = people.users.map((user) => ({ id: user.id, label: user.name }));
    const usual = (truck: string) => {
      const vehicle = lookups.vehicles.find((row) => _truck.find((option) => option.label === truck)?.id === row.id);
      return _driver.find((option) => option.id === vehicle?.driverUserId)?.label ?? "None";
    };
    return {
      _truck,
      _driver,
      _usual: Object.fromEntries(_truck.map((option) => [option.label, usual(option.label)])),
      _destination: lookups.destinations.map((row) => ({ id: row.id, label: row.name })),
      truck: _truck[0]?.label ?? "",
      driver: _truck[0] ? usual(_truck[0].label) : "None",
      destination: "None",
    };
  },
  sections: [
    {
      fields: [
        {
          id: "truck",
          t: "text",
          l: "Truck",
          o: (values) => labels(values, "truck"),
          follow: async (value, values) => ({ driver: ((values._usual as Record<string, string> | undefined) ?? {})[String(value)] ?? values.driver }),
        },
        { id: "driver", t: "text", l: "Driver", o: (values) => labels(values, "driver", true), h: "They record proof of delivery on their phone." },
        { id: "destination", t: "text", l: "Destination", o: (values) => labels(values, "destination", true) },
      ],
    },
  ],
  note: "The load is checked against the truck before it leaves.",
  primary: "Create",
  done: (result) => `${String((result as { code?: string } | null)?.code ?? "Despatch note")} created`,
  next: (result) => {
    const id = (result as { id?: string } | null)?.id;
    return id ? `/milling/deliveries/${id}` : null;
  },
  submit: (values) => ({ method: "POST", url: "/api/milling/deliveries", body: { vehicleId: idOf(values, "truck"), driverId: idOf(values, "driver"), destinationId: idOf(values, "destination") } }),
  invalidate: [["list"], ["milling"]],
  requires: [["ext:milling", "delivery.manage"]],
};

export const DESPATCH_SHEETS: Record<string, SheetKind> = {
  "mill-despatch-new": despatchNew,
};

type RouteVehicle = { id: string; name: string; equipmentCode: string };

/** New route (DS-B2): a code, a name, the days it runs and its usual truck. Its stops are added on the route. */
const routeNew: SheetKind = {
  title: "New route",
  sub: "Its shops are added on the route, in the order the truck visits them.",
  cur: "US$",
  load: async () => {
    const data = await fetchJson<{ vehicles: RouteVehicle[] }>("/api/milling/routes");
    return { _vehicle: data.vehicles.map((vehicle) => ({ id: vehicle.id, label: `${vehicle.equipmentCode} ${vehicle.name}` })), vehicle: "None", days: [] };
  },
  sections: [
    {
      fields: [
        { id: "code", t: "text", l: "Code", half: true, mono: true, upper: true, max: 20, p: "RT-05", needed: "Give the route a code." },
        { id: "name", t: "text", l: "Name", half: true, max: 100, p: "Shamva", needed: "Name the route." },
        { id: "days", t: "days", l: "Runs on", opt: true },
        { id: "vehicle", t: "text", l: "Usual truck", o: (values) => labels(values, "vehicle", true) },
      ],
    },
  ],
  note: "",
  primary: "Create route",
  done: (_result, values) => `${String(values.code ?? "Route")} created`,
  next: (result) => {
    const id = (result as { id?: string } | null)?.id;
    return id ? `/milling/routes/${id}` : null;
  },
  submit: (values) => ({ method: "POST", url: "/api/milling/routes", body: { code: String(values.code ?? "").trim(), name: String(values.name ?? "").trim(), visitDays: (values.days as number[] | undefined) ?? [], vehicleId: idOf(values, "vehicle"), isActive: true } }),
  invalidate: [["list"], ["milling"]],
  requires: [["ext:milling", "delivery.manage"]],
};

DESPATCH_SHEETS["mill-route-new"] = routeNew;

type RouteDetail = { id: string; code: string; name: string; isActive: boolean; visitDays: number[]; vehicleId: string | null; stops: Array<{ id: string; stop: number }> };
type RouteLookups = { vehicles: RouteVehicle[]; customers: Array<{ id: string; name: string; area: string | null; routeId: string | null }> };

/** Edit a route (DS-B3): its name, days, usual truck, and whether it still runs. */
const routeEdit: SheetKind = {
  ...routeNew,
  title: (_ctx, values) => `Edit ${String(values.code ?? "the route")}`,
  sub: "Its stops are changed under Stops.",
  load: async (ctx) => {
    const [route, lookups] = await Promise.all([fetchJson<RouteDetail>(`/api/milling/routes/${ctx.id}`), fetchJson<RouteLookups>("/api/milling/routes")]);
    const _vehicle = lookups.vehicles.map((vehicle) => ({ id: vehicle.id, label: `${vehicle.equipmentCode} ${vehicle.name}` }));
    return { _vehicle, code: route.code, name: route.name, days: route.visitDays, vehicle: _vehicle.find((option) => option.id === route.vehicleId)?.label ?? "None", running: route.isActive };
  },
  sections: [{ fields: [...routeNew.sections[0]!.fields, { id: "running", t: "toggle", l: "The route runs", h: "A stopped route plans no trips and the rep's day leaves it out." }] }],
  primary: "Save",
  done: (_result, values) => `${String(values.code ?? "Route")} saved`,
  next: undefined,
  submit: (values, ctx) => ({ method: "POST", url: `/api/milling/routes/${ctx.id}`, body: { code: String(values.code ?? "").trim(), name: String(values.name ?? "").trim(), visitDays: (values.days as number[] | undefined) ?? [], vehicleId: idOf(values, "vehicle"), isActive: values.running === true } }),
};

const STOP_SLOTS = 40;

/** A route's stops (DS-B3): which shops it visits, and in what order. A shop is on one route at a time. */
const routeStops: SheetKind = {
  title: (_ctx, values) => `Stops on ${String(values._code ?? "the route")}`,
  sub: "Tick the shops the truck visits and number them in order. A shop on another route moves to this one.",
  wide: true,
  cur: "US$",
  load: async (ctx) => {
    const [route, lookups] = await Promise.all([fetchJson<RouteDetail>(`/api/milling/routes/${ctx.id}`), fetchJson<RouteLookups>("/api/milling/routes")]);
    const order = new Map(route.stops.map((stop) => [stop.id, stop.stop]));
    const customers = [...lookups.customers].sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999) || a.name.localeCompare(b.name)).slice(0, STOP_SLOTS);
    return {
      _code: route.code,
      _shops: customers.map((customer) => ({ id: customer.id, name: customer.name, sub: customer.routeId && customer.routeId !== route.id ? "on another route" : customer.area })),
      ...Object.fromEntries(customers.flatMap((customer, index) => [[`on${index}`, order.has(customer.id)], [`at${index}`, order.has(customer.id) ? String(order.get(customer.id)) : ""]])),
    };
  },
  sections: [
    {
      fields: slotFields("shops", STOP_SLOTS, (index, item) => [
        { id: `on${index}`, t: "toggle", l: "", lw: (values) => `${item(values)?.name ?? ""}${item(values)?.sub ? ` · ${item(values)?.sub}` : ""}`, half: true, opt: true, optQuiet: true },
        { id: `at${index}`, t: "text", l: "Stop", half: true, mono: true, right: true, inputMode: "numeric", opt: true, optQuiet: true, disabled: (values) => values[`on${index}`] !== true },
      ]),
    },
  ],
  note: (values) => `${stopOrder(values).length} stops.`,
  primary: "Save stops",
  done: "Stops saved",
  submit: (values, ctx) => ({ method: "POST", url: `/api/milling/routes/${ctx.id}/stops`, body: { customerIds: stopOrder(values) } }),
  invalidate: [["list"], ["reports"], ["milling"], ["milling-route"]],
  requires: [["ext:milling", "delivery.manage"]],
};

function stopOrder(values: SheetValues): string[] {
  return slotItems(values, "shops")
    .map((shop, index) => ({ id: shop.id, on: values[`on${index}`] === true, at: Number(values[`at${index}`]) || 999, index }))
    .filter((row) => row.on)
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map((row) => row.id);
}

DESPATCH_SHEETS["mill-route-edit"] = routeEdit;
DESPATCH_SHEETS["mill-route-stops"] = routeStops;
