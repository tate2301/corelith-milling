import type { MillLookups } from "@/components/milling/mill-ui";
import { fetchJson } from "@/lib/api-client";
import type { SheetKind } from "@/lib/workspace/sheet-kind";

import { idOf, labels, type Choice } from "./choices";

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
