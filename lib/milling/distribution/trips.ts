import type { PrismaClient } from "@prisma/client";

import { createCustomerRoute, placeCustomer, RouteRefusal, updateCustomerRoute, type RouteInput } from "@/lib/customers/routes";

import { millRefusal } from "../errors";
import { planDelivery } from "./deliveries";

/**
 * Trips and routes (canvas DS-B1 to DS-B3).
 *
 * A trip is a delivery once its vehicle has gone out: the run, with its
 * odometer and fuel. A route is core's customer route: customers visited in
 * order on set days, usually by one vehicle. A trip planned from a route
 * remembers it, so the route shows its last trips and what they cost in fuel.
 */

type Db = PrismaClient;
const ON_THE_ROAD = ["DISPATCHED", "DELIVERED", "CLOSED"];
const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function visitDaysLabel(days: readonly number[]): string {
  return days.length ? days.map((day) => DAY[day] ?? "").join(", ") : "Any day";
}

/** Kilometres, litres and km a litre of a run, when both readings and the fuel are in. */
export function runFigures(row: { odometerOut: unknown; odometerIn: unknown; fuelLitres: unknown }) {
  const out = row.odometerOut === null || row.odometerOut === undefined ? null : Number(row.odometerOut);
  const back = row.odometerIn === null || row.odometerIn === undefined ? null : Number(row.odometerIn);
  const km = out !== null && back !== null && back >= out ? back - out : null;
  const litres = row.fuelLitres === null || row.fuelLitres === undefined ? null : Number(row.fuelLitres);
  return { km, litres, kmPerLitre: km !== null && litres ? Math.round((km / litres) * 100) / 100 : null };
}

export async function vehicleLabels(db: Db, companyId: string, ids: string[]) {
  const [equipment, profiles] = await Promise.all([
    db.equipment.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, equipmentCode: true, registrationNumber: true } }),
    db.millingVehicleProfile.findMany({ where: { companyId, equipmentId: { in: ids } }, select: { equipmentId: true, registrationNumber: true } }),
  ]);
  return (id: string | null) => {
    if (!id) return null;
    const row = equipment.find((entry) => entry.id === id);
    return profiles.find((entry) => entry.equipmentId === id)?.registrationNumber ?? row?.registrationNumber ?? row?.equipmentCode ?? row?.name ?? null;
  };
}

/** Trips: deliveries that have left, newest first, with what each delivered and its fuel. */
export async function listTrips(db: Db, companyId: string, args: { status?: "OUT" | "CLOSED" | null; routeId?: string | null; take?: number } = {}) {
  const status = args.status === "OUT" ? { in: ["DISPATCHED", "DELIVERED"] } : args.status === "CLOSED" ? "CLOSED" : { in: ON_THE_ROAD };
  const rows = await db.millingDelivery.findMany({
    where: { companyId, status, ...(args.routeId ? { routeId: args.routeId } : {}) },
    orderBy: [{ dispatchedAt: "desc" }, { createdAt: "desc" }],
    take: args.take ?? 200,
    include: { lines: { select: { orderId: true, bags: true, deliveredBags: true } } },
  });
  const [vehicle, drivers, routes, counts] = await Promise.all([
    vehicleLabels(db, companyId, [...new Set(rows.map((row) => row.vehicleId))]),
    db.user.findMany({ where: { companyId, id: { in: rows.map((row) => row.driverId).filter((id): id is string => Boolean(id)) } }, select: { id: true, name: true } }),
    db.customerRoute.findMany({ where: { companyId, id: { in: rows.map((row) => row.routeId).filter((id): id is string => Boolean(id)) } }, select: { id: true, code: true, name: true } }),
    db.millingDelivery.groupBy({ by: ["status"], where: { companyId, status: { in: ON_THE_ROAD } }, _count: { _all: true } }),
  ]);
  const count = (statuses: string[]) => counts.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);
  const trips = rows.map((row) => {
    const orders = new Map<string, { bags: number; delivered: number }>();
    for (const line of row.lines) {
      const entry = orders.get(line.orderId) ?? { bags: 0, delivered: 0 };
      entry.bags += line.bags;
      entry.delivered += line.deliveredBags ?? 0;
      orders.set(line.orderId, entry);
    }
    const route = routes.find((entry) => entry.id === row.routeId) ?? null;
    return {
      id: row.id,
      code: row.code,
      status: row.status,
      route: route ? { id: route.id, code: route.code, name: route.name } : null,
      vehicle: vehicle(row.vehicleId),
      driver: drivers.find((entry) => entry.id === row.driverId)?.name ?? null,
      date: row.dispatchedAt ?? row.createdAt,
      stops: orders.size,
      // A stop counts as delivered once any of its bags were taken; before proof of delivery, none are.
      delivered: [...orders.values()].filter((entry) => entry.delivered > 0).length,
      bags: [...orders.values()].reduce((sum, entry) => sum + entry.bags, 0),
      ...runFigures(row),
    };
  });
  const km = trips.reduce((sum, trip) => sum + (trip.km ?? 0), 0);
  const litres = trips.reduce((sum, trip) => sum + (trip.litres ?? 0), 0);
  return {
    counts: { ALL: count(ON_THE_ROAD), OUT: count(["DISPATCHED", "DELIVERED"]), CLOSED: count(["CLOSED"]) },
    trips,
    totals: { trips: trips.length, km, litres, kmPerLitre: litres ? Math.round((km / litres) * 100) / 100 : null },
  };
}

/** Routes with their stops, days, usual vehicle and the kilometres of their last trip. */
export async function listRoutes(db: Db, companyId: string) {
  const routes = await db.customerRoute.findMany({
    where: { companyId },
    orderBy: { code: "asc" },
    include: { customers: { where: { archivedAt: null }, select: { area: true } } },
  });
  const vehicle = await vehicleLabels(db, companyId, routes.map((route) => route.vehicleId).filter((id): id is string => Boolean(id)));
  const last = await Promise.all(
    routes.map((route) =>
      db.millingDelivery.findFirst({ where: { companyId, routeId: route.id, status: "CLOSED" }, orderBy: { closedAt: "desc" }, select: { odometerOut: true, odometerIn: true, fuelLitres: true } }),
    ),
  );
  return routes.map((route, index) => ({
    id: route.id,
    code: route.code,
    name: route.name,
    isActive: route.isActive,
    areas: [...new Set(route.customers.map((row) => row.area).filter((area): area is string => Boolean(area)))].join(", ") || route.name,
    stops: route.customers.length,
    visitDays: route.visitDays,
    visitDaysLabel: visitDaysLabel(route.visitDays),
    vehicleId: route.vehicleId,
    vehicle: vehicle(route.vehicleId),
    km: last[index] ? runFigures(last[index]!).km : null,
  }));
}

/** One route: its stops in order and its last trips. */
export async function routeDetail(db: Db, companyId: string, routeId: string) {
  const route = await db.customerRoute.findFirst({
    where: { id: routeId, companyId },
    include: {
      customers: { where: { archivedAt: null }, orderBy: [{ routeStop: "asc" }, { name: "asc" }], select: { id: true, name: true, area: true, routeStop: true } },
      rep: { select: { id: true, name: true } },
    },
  });
  if (!route) return null;
  const vehicle = await vehicleLabels(db, companyId, route.vehicleId ? [route.vehicleId] : []);
  const trips = await listTrips(db, companyId, { routeId, take: 10 });
  return {
    id: route.id,
    code: route.code,
    name: route.name,
    isActive: route.isActive,
    visitDays: route.visitDays,
    visitDaysLabel: visitDaysLabel(route.visitDays),
    vehicleId: route.vehicleId,
    vehicle: vehicle(route.vehicleId),
    rep: route.rep,
    stops: route.customers.map((customer, index) => ({ id: customer.id, name: customer.name, area: customer.area, stop: customer.routeStop ?? index + 1 })),
    trips: trips.trips,
  };
}

function refuse(error: unknown): never {
  if (error instanceof RouteRefusal) throw millRefusal(error.message);
  throw error;
}

export async function saveRoute(db: Db, companyId: string, input: RouteInput & { id?: string | null }) {
  try {
    const { id, ...fields } = input;
    return id ? await updateCustomerRoute(companyId, id, fields, db) : await createCustomerRoute(companyId, fields, db);
  } catch (error) {
    refuse(error);
  }
}

/** Put the route's stops in this order: the customers named, first to last. Customers left out come off the route. */
export async function setRouteStops(db: Db, companyId: string, routeId: string, customerIds: string[]) {
  if (new Set(customerIds).size !== customerIds.length) throw millRefusal("A customer is on the list twice.");
  try {
    return await db.$transaction(async (tx) => {
      const route = await tx.customerRoute.findFirst({ where: { id: routeId, companyId }, select: { id: true } });
      if (!route) throw millRefusal("That route is not in this workspace.");
      const current = await tx.customer.findMany({ where: { companyId, routeId }, select: { id: true } });
      for (const row of current) if (!customerIds.includes(row.id)) await placeCustomer(companyId, row.id, { routeId: null }, tx);
      // Off first, then on in order: each goes last, so the order is the list's.
      for (const id of customerIds) await placeCustomer(companyId, id, { routeId: null }, tx);
      for (const id of customerIds) await placeCustomer(companyId, id, { routeId }, tx);
      return tx.customer.findMany({ where: { routeId }, orderBy: { routeStop: "asc" }, select: { id: true, name: true, routeStop: true } });
    });
  } catch (error) {
    refuse(error);
  }
}

/** Plan a trip on a route: a delivery with the route's usual vehicle unless another is chosen. */
export async function planRouteTrip(db: Db, args: { companyId: string; userId: string; routeId: string; vehicleId?: string | null; driverId?: string | null }) {
  const route = await db.customerRoute.findFirst({ where: { id: args.routeId, companyId: args.companyId, isActive: true }, select: { id: true, code: true, vehicleId: true } });
  if (!route) throw millRefusal("That route is not running.");
  const vehicleId = args.vehicleId ?? route.vehicleId;
  if (!vehicleId) throw millRefusal(`${route.code} has no usual vehicle; choose one.`);
  const delivery = await planDelivery(db, { companyId: args.companyId, userId: args.userId, vehicleId, driverId: args.driverId ?? null, notes: `Route ${route.code}` });
  return db.millingDelivery.update({ where: { id: delivery.id }, data: { routeId: route.id } });
}
