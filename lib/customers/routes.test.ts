import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { createCustomerRoute, placeCustomer, readCustomerRoute, RouteRefusal, updateCustomerRoute } from "./routes";

const stamp = `routes-${Date.now()}`;
let companyId: string;
let otherCompanyId: string;
let routeId: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: stamp, slug: stamp } })).id;
  otherCompanyId = (await prisma.company.create({ data: { name: `${stamp}-x`, slug: `${stamp}-x` } })).id;
  for (const name of ["Shamva Spar", "Mazowe Tuck", "Nyabira OK", "Hatcliffe Bakery"]) {
    ids[name] = (await prisma.customer.create({ data: { companyId, name } })).id;
  }
  routeId = (await createCustomerRoute(companyId, { code: "R1", name: "North run", visitDays: [3, 1, 1] })).id;
});

afterAll(async () => {
  const companies = [companyId, otherCompanyId].filter(Boolean);
  await prisma.customer.deleteMany({ where: { companyId: { in: companies } } });
  await prisma.customerRoute.deleteMany({ where: { companyId: { in: companies } } });
  await prisma.company.deleteMany({ where: { id: { in: companies } } });
});

const order = async () => (await readCustomerRoute(companyId, routeId))!.customers.map((c) => [c.name, c.routeStop]);

describe("customer routes", () => {
  it("keeps visit days as sorted weekdays and refuses others, and duplicate codes", async () => {
    const route = await prisma.customerRoute.findUniqueOrThrow({ where: { id: routeId } });
    expect(route.visitDays).toEqual([1, 3]);
    await expect(createCustomerRoute(companyId, { code: "R2", name: "x", visitDays: [8] })).rejects.toThrow(/1 \(Monday\) to 7/);
    await expect(createCustomerRoute(companyId, { code: "R1", name: "again", visitDays: [] })).rejects.toThrow(/already exists/);
  });

  it("adds customers last, inserts at a stop, and closes the gap when one moves or leaves", async () => {
    await placeCustomer(companyId, ids["Shamva Spar"]!, { routeId });
    await placeCustomer(companyId, ids["Mazowe Tuck"]!, { routeId });
    await placeCustomer(companyId, ids["Nyabira OK"]!, { routeId, routeStop: 1 });
    expect(await order()).toEqual([["Nyabira OK", 1], ["Shamva Spar", 2], ["Mazowe Tuck", 3]]);

    await placeCustomer(companyId, ids["Nyabira OK"]!, { routeId, routeStop: 3 });
    expect(await order()).toEqual([["Shamva Spar", 1], ["Mazowe Tuck", 2], ["Nyabira OK", 3]]);

    await placeCustomer(companyId, ids["Shamva Spar"]!, { routeId: null });
    expect(await order()).toEqual([["Mazowe Tuck", 1], ["Nyabira OK", 2]]);
  });

  it("records where a customer is, and refuses half a location or one off the map", async () => {
    const placed = await placeCustomer(companyId, ids["Hatcliffe Bakery"]!, { latitude: -17.69, longitude: 31.1 });
    expect([placed.latitude, placed.longitude]).toEqual([-17.69, 31.1]);
    await expect(placeCustomer(companyId, ids["Hatcliffe Bakery"]!, { latitude: -17.69 })).rejects.toThrow(/both latitude and longitude/);
    await expect(placeCustomer(companyId, ids["Hatcliffe Bakery"]!, { latitude: -95, longitude: 31 })).rejects.toThrow(/-90 to 90/);
  });

  it("refuses another company's route, customer, rep or vehicle", async () => {
    const theirs = await createCustomerRoute(otherCompanyId, { code: "R1", name: "Theirs", visitDays: [] });
    await expect(placeCustomer(companyId, ids["Mazowe Tuck"]!, { routeId: theirs.id })).rejects.toThrow(RouteRefusal);
    await expect(placeCustomer(otherCompanyId, ids["Mazowe Tuck"]!, { routeId: theirs.id })).rejects.toThrow("Customer not found.");
    await expect(updateCustomerRoute(otherCompanyId, routeId, { name: "x" })).rejects.toThrow("Route not found.");
    await expect(updateCustomerRoute(companyId, routeId, { repUserId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(/rep/);
    expect(await readCustomerRoute(otherCompanyId, routeId)).toBeNull();
  });
});
