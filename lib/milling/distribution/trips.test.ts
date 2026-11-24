import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { makeMill, removeMill } from "../testing/fixture";
import { listRoutes, listTrips, planRouteTrip, routeDetail, runFigures, saveRoute, setRouteStops, visitDaysLabel } from "./trips";

let mill: Awaited<ReturnType<typeof makeMill>>;
let truckId = "";
let routeId = "";
const customers: string[] = [];

beforeAll(async () => {
  mill = await makeMill("trips");
  truckId = (await prisma.equipment.findFirstOrThrow({ where: { siteId: mill.siteId, equipmentCode: "UD-1" } })).id;
  await prisma.millingVehicleProfile.update({ where: { equipmentId: truckId }, data: { registrationNumber: "AFZ 3307" } });
  for (const name of ["Nyabira Grain Wholesalers", "Nyabira Family Supermarket", "Nyabira Trading"]) {
    customers.push((await prisma.customer.create({ data: { companyId: mill.companyId, name, area: "Nyabira" } })).id);
  }
});
afterAll(async () => {
  await prisma.customer.updateMany({ where: { companyId: mill.companyId }, data: { routeId: null } });
  await prisma.customerRoute.deleteMany({ where: { companyId: mill.companyId } });
  await removeMill(mill.companyId);
});

describe("routes and trips", () => {
  it("keeps a route's stops in the order given", async () => {
    const route = await saveRoute(prisma, mill.companyId, { code: "RT-03", name: "Nyabira", visitDays: [5], vehicleId: truckId });
    routeId = route!.id;
    await setRouteStops(prisma, mill.companyId, routeId, [customers[2]!, customers[0]!, customers[1]!]);
    const reordered = await setRouteStops(prisma, mill.companyId, routeId, [customers[0]!, customers[1]!, customers[2]!]);
    expect(reordered!.map((row) => [row.name, row.routeStop])).toEqual([
      ["Nyabira Grain Wholesalers", 1],
      ["Nyabira Family Supermarket", 2],
      ["Nyabira Trading", 3],
    ]);
    const [listed] = await listRoutes(prisma, mill.companyId);
    expect(listed).toMatchObject({ code: "RT-03", areas: "Nyabira", stops: 3, visitDaysLabel: "Fri", vehicle: "AFZ 3307" });
    await expect(setRouteStops(prisma, mill.companyId, routeId, [customers[0]!, customers[0]!])).rejects.toThrow("twice");
  });

  it("plans a trip on the route's usual vehicle and counts it as a trip once it leaves", async () => {
    const trip = await planRouteTrip(prisma, { companyId: mill.companyId, userId: mill.userId, routeId });
    expect([trip.routeId, trip.vehicleId]).toEqual([routeId, truckId]);
    expect((await listTrips(prisma, mill.companyId)).trips).toHaveLength(0);

    await prisma.millingDelivery.update({ where: { id: trip.id }, data: { status: "CLOSED", dispatchedAt: new Date("2026-11-13T07:05:00Z"), closedAt: new Date(), odometerOut: 118420, odometerIn: 118562, fuelLitres: 38 } });
    const { trips, totals, counts } = await listTrips(prisma, mill.companyId);
    expect(trips[0]).toMatchObject({ code: trip.code, route: { code: "RT-03" }, vehicle: "AFZ 3307", km: 142, litres: 38, kmPerLitre: 3.74 });
    expect(totals).toMatchObject({ trips: 1, km: 142, litres: 38 });
    expect(counts).toEqual({ ALL: 1, OUT: 0, CLOSED: 1 });
    const detail = await routeDetail(prisma, mill.companyId, routeId);
    expect(detail?.trips.map((row) => row.code)).toEqual([trip.code]);
    expect((await listRoutes(prisma, mill.companyId))[0]?.km).toBe(142);
  });

  it("works out nothing it cannot", () => {
    expect(runFigures({ odometerOut: 100, odometerIn: null, fuelLitres: 10 })).toEqual({ km: null, litres: 10, kmPerLitre: null });
    expect(visitDaysLabel([1, 4])).toBe("Mon, Thu");
  });
});
