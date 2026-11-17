import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

export class RouteRefusal extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "RouteRefusal";
  }
}

export type RouteInput = {
  code: string;
  name: string;
  /** ISO weekdays, 1 (Monday) to 7. */
  visitDays: number[];
  repUserId?: string | null;
  vehicleId?: string | null;
  isActive?: boolean;
};

function weekdays(days: readonly number[]): number[] {
  for (const day of days) if (!Number.isInteger(day) || day < 1 || day > 7) throw new RouteRefusal("Visit days run from 1 (Monday) to 7 (Sunday).");
  return [...new Set(days)].sort((a, b) => a - b);
}

/** The rep must be the company's person and the vehicle the company's equipment. */
async function checkWorkers(db: Db, companyId: string, input: Pick<RouteInput, "repUserId" | "vehicleId">) {
  if (input.repUserId) {
    const rep = await db.user.findUnique({ where: { id: input.repUserId }, select: { companyId: true } });
    if (!rep || rep.companyId !== companyId) throw new RouteRefusal("That rep is not in this workspace.");
  }
  if (input.vehicleId) {
    const vehicle = await db.equipment.findUnique({ where: { id: input.vehicleId }, select: { site: { select: { companyId: true } } } });
    if (!vehicle || vehicle.site.companyId !== companyId) throw new RouteRefusal("That vehicle is not in this workspace.");
  }
}

export async function createCustomerRoute(companyId: string, input: RouteInput, db: Db = prisma) {
  await checkWorkers(db, companyId, input);
  try {
    return await db.customerRoute.create({
      data: {
        companyId,
        code: input.code.trim(),
        name: input.name.trim(),
        visitDays: weekdays(input.visitDays),
        repUserId: input.repUserId ?? null,
        vehicleId: input.vehicleId ?? null,
        isActive: input.isActive ?? true,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new RouteRefusal(`A route with the code ${input.code} already exists.`, 409);
    }
    throw error;
  }
}

export async function updateCustomerRoute(companyId: string, id: string, input: Partial<RouteInput>, db: Db = prisma) {
  const route = await db.customerRoute.findUnique({ where: { id }, select: { companyId: true } });
  if (!route || route.companyId !== companyId) throw new RouteRefusal("Route not found.", 404);
  await checkWorkers(db, companyId, input);
  return db.customerRoute.update({
    where: { id },
    data: {
      code: input.code?.trim(),
      name: input.name?.trim(),
      visitDays: input.visitDays ? weekdays(input.visitDays) : undefined,
      repUserId: input.repUserId,
      vehicleId: input.vehicleId,
      isActive: input.isActive,
    },
  });
}

/** A route with its customers in the order they are visited. */
export async function readCustomerRoute(companyId: string, id: string, db: Db = prisma) {
  const route = await db.customerRoute.findUnique({
    where: { id },
    include: {
      rep: { select: { id: true, name: true } },
      vehicle: { select: { id: true, name: true, registrationNumber: true } },
      customers: {
        where: { archivedAt: null },
        orderBy: [{ routeStop: "asc" }, { name: "asc" }],
        select: { id: true, name: true, area: true, phone: true, routeStop: true, latitude: true, longitude: true },
      },
    },
  });
  if (!route || route.companyId !== companyId) return null;
  return route;
}

export type CustomerPlace = {
  routeId?: string | null;
  /** Its place in the route's order; left out, the customer goes last. */
  routeStop?: number | null;
  latitude?: number | null;
  longitude?: number | null;
};

/**
 * Puts a customer on a route (or takes them off with `routeId: null`) and
 * records where they are. A stop number already taken moves the customers
 * from it on down by one, so the order stays a list without gaps or ties.
 */
export async function placeCustomer(companyId: string, customerId: string, place: CustomerPlace, db: Db = prisma) {
  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { companyId: true, routeId: true, routeStop: true } });
  if (!customer || customer.companyId !== companyId) throw new RouteRefusal("Customer not found.", 404);
  if ((place.latitude == null) !== (place.longitude == null) && (place.latitude !== undefined || place.longitude !== undefined)) {
    throw new RouteRefusal("A location needs both latitude and longitude.");
  }
  if (place.latitude != null && (place.latitude < -90 || place.latitude > 90)) throw new RouteRefusal("Latitude runs from -90 to 90.");
  if (place.longitude != null && (place.longitude < -180 || place.longitude > 180)) throw new RouteRefusal("Longitude runs from -180 to 180.");

  const data: Prisma.CustomerUncheckedUpdateInput = { latitude: place.latitude, longitude: place.longitude };
  if (place.routeId !== undefined) {
    // Leaving its old place closes the gap behind it.
    if (customer.routeId && customer.routeStop != null) {
      await db.customer.updateMany({
        where: { routeId: customer.routeId, id: { not: customerId }, routeStop: { gt: customer.routeStop } },
        data: { routeStop: { decrement: 1 } },
      });
    }
    if (place.routeId === null) {
      data.routeId = null;
      data.routeStop = null;
    } else {
      const route = await db.customerRoute.findUnique({ where: { id: place.routeId }, select: { companyId: true } });
      if (!route || route.companyId !== companyId) throw new RouteRefusal("Route not found.", 404);
      const last = await db.customer.aggregate({
        where: { routeId: place.routeId, id: { not: customerId } },
        _max: { routeStop: true },
      });
      const end = (last._max.routeStop ?? 0) + 1;
      const stop = place.routeStop == null ? end : Math.max(1, Math.min(Math.trunc(place.routeStop), end));
      await db.customer.updateMany({
        where: { routeId: place.routeId, id: { not: customerId }, routeStop: { gte: stop } },
        data: { routeStop: { increment: 1 } },
      });
      data.routeId = place.routeId;
      data.routeStop = stop;
    }
  }
  return db.customer.update({ where: { id: customerId }, data });
}
