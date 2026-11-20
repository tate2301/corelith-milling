import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { directorDay } from "../reports/director";
import { makeMill, removeMill } from "../testing/fixture";
import { collections, customerAccount, recordPromise, recordVisit, setCustomerTerms, surveyByRoute } from "./customers";
import { repDay } from "./rep";

let mill: Awaited<ReturnType<typeof makeMill>>;
let routeId = "";
const shops: string[] = [];
const who = () => ({ companyId: mill.companyId, userId: mill.userId });
// Friday 20 November 2026, 09:00 in Harare.
const NOW = new Date("2026-11-20T07:00:00Z");

beforeAll(async () => {
  mill = await makeMill("customers");
  routeId = (await prisma.customerRoute.create({ data: { companyId: mill.companyId, code: "RT-03", name: "Nyabira", visitDays: [5], repUserId: mill.userId } })).id;
  for (const [index, name] of ["Nyabira Grain Wholesalers", "Nyabira Family Supermarket", "Nyabira Trading"].entries()) {
    shops.push((await prisma.customer.create({ data: { companyId: mill.companyId, name, area: "Nyabira", routeId, routeStop: index + 1 } })).id);
  }
  const invoice = (customerId: string, total: number, paid: number, due: string) =>
    prisma.salesInvoice.create({ data: { companyId: mill.companyId, customerId, invoiceDate: new Date("2026-10-15"), dueDate: new Date(due), status: "ISSUED", total, amountPaid: paid } });
  await invoice(shops[2]!, 620, 0, "2026-10-30");
  await invoice(shops[2]!, 800, 0, "2026-11-27");
  await invoice(shops[0]!, 3150, 0, "2026-12-01");
  await invoice(shops[1]!, 500, 500, "2026-11-01");
  await setCustomerTerms(prisma, { ...who(), customerId: shops[2]!, creditLimit: 1500, termsDays: 14 });
  await setCustomerTerms(prisma, { ...who(), customerId: shops[0]!, creditLimit: 3000, termsDays: 30 });
});
afterAll(async () => {
  await prisma.salesInvoice.deleteMany({ where: { companyId: mill.companyId } });
  await prisma.millingVisit.deleteMany({ where: { companyId: mill.companyId } });
  await prisma.millingPaymentPromise.deleteMany({ where: { companyId: mill.companyId } });
  await prisma.millingCustomerTerms.deleteMany({ where: { companyId: mill.companyId } });
  await prisma.customer.updateMany({ where: { companyId: mill.companyId }, data: { routeId: null } });
  await prisma.customerRoute.deleteMany({ where: { companyId: mill.companyId } });
  await removeMill(mill.companyId);
});

describe("collections", () => {
  it("lists who owes, overdue first, with their state against their limit", async () => {
    const view = await collections(prisma, mill.companyId, NOW);
    expect(view.rows.map((row) => [row.name, row.owes, row.overdue, row.state])).toEqual([
      ["Nyabira Trading", 1420, 620, "OVERDUE"],
      ["Nyabira Grain Wholesalers", 3150, 0, "OVER_LIMIT"],
    ]);
    expect(view.counts).toEqual({ ALL: 2, OVERDUE: 1, OVER_LIMIT: 1 });
    expect(view.totals).toEqual({ creditLimit: 4500, owes: 4570, overdue: 620 });
  });

  it("takes a promise for what is owed, on a day not past", async () => {
    await expect(recordPromise(prisma, { ...who(), customerId: shops[2]!, amount: 2000, promisedFor: "2026-11-25", at: NOW })).rejects.toThrow("cannot be for more");
    await expect(recordPromise(prisma, { ...who(), customerId: shops[2]!, amount: 620, promisedFor: "2026-11-01", at: NOW })).rejects.toThrow("today or later");
    await expect(recordPromise(prisma, { ...who(), customerId: shops[1]!, amount: 10, promisedFor: "2026-11-25", at: NOW })).rejects.toThrow("owes nothing");
    await recordPromise(prisma, { ...who(), customerId: shops[2]!, amount: 620, promisedFor: "2026-11-25", at: NOW });
    const account = await customerAccount(prisma, mill.companyId, shops[2]!, NOW);
    expect(account?.invoices.map((row) => [row.open, row.daysLate > 0])).toEqual([[620, true], [800, false]]);
    expect(account?.promises[0]?.amount).toBe(620);
  });
});

describe("visits and the survey by route", () => {
  it("records what the rep saw, and refuses nonsense", async () => {
    await expect(recordVisit(prisma, { ...who(), customerId: shops[1]!, shelfSharePct: 140 })).rejects.toThrow("0 to 100");
    await recordVisit(prisma, { ...who(), customerId: shops[0]!, competitorPrice: 6.4, ourBagsOnShelf: 30, shelfSharePct: 50, at: NOW });
    await recordVisit(prisma, { ...who(), customerId: shops[1]!, competitorPrice: 6.6, ourBagsOnShelf: 24, shelfSharePct: 40, at: NOW });
    const [survey] = await surveyByRoute(prisma, mill.companyId, { from: new Date("2026-11-01"), to: new Date("2026-12-01") });
    expect(survey).toMatchObject({ route: "RT-03, Nyabira", visits: 2, shops: 2, competitorPrice: 6.5, shelfSharePct: 45, ourBagsOnShelf: 54 });
  });

  it("gives the rep today's route, what each shop owes, and the next to visit", async () => {
    const day = await repDay(prisma, { ...who(), at: NOW });
    expect(day.route?.code).toBe("RT-03");
    expect(day.stops.map((stop) => [stop.name, stop.visited, stop.state])).toEqual([
      ["Nyabira Grain Wholesalers", true, "OVER_LIMIT"],
      ["Nyabira Family Supermarket", true, "CURRENT"],
      ["Nyabira Trading", false, "OVERDUE"],
    ]);
    expect(day.next?.name).toBe("Nyabira Trading");
  });
});

describe("the director's day", () => {
  it("reads yesterday's figures and says nothing of extraction with no runs", async () => {
    const day = await directorDay(prisma, mill.companyId, NOW);
    expect(day.day).toBe("2026-11-19");
    expect(day.figures.extractionPct).toBeNull();
    expect(day.shortfall).toBeNull();
    expect(day.targetPct).toBe(72);
  });
});
