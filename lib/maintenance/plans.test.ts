/**
 * Preventive maintenance plans: the next due by date, by meter (forecast from
 * the meter's recent climb) and whichever comes first; where a plan stands;
 * services raised by themselves when due, once; and a completed service
 * moving the plan on. Against the test database for the stored parts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { destroyProvisionedTenant } from "@/lib/platform/tenant-teardown";
import { makeTestShop, type TestShop } from "@/lib/retail/products/test-fixtures";

import { recordMeterReading } from "./meters";
import { createPlan, dailyRate, nextDue, planState, PlanRefused, raiseDueServices, raiseService, serviceDone } from "./plans";

const DAY = 86_400_000;
const at = (iso: string) => new Date(`${iso}T08:00:00Z`);

describe("the next due (pure)", () => {
  const plan = { intervalDays: 90, intervalMeter: null, startedAt: at("2026-01-01"), lastDoneAt: null, lastDoneMeter: null };

  it("counts days from the last service, or from the plan's start", () => {
    expect(nextDue(plan, { current: null, readings: [] }, at("2026-02-01"))).toEqual({ at: at("2026-04-01"), meter: null, by: "DATE" });
    expect(nextDue({ ...plan, lastDoneAt: at("2026-03-01") }, { current: null, readings: [] }).at).toEqual(at("2026-05-30"));
  });

  it("forecasts the day the meter gets there from its recent climb", () => {
    const readings = [
      { reading: 1000, readAt: at("2026-03-01") },
      { reading: 1300, readAt: at("2026-03-31") },
    ];
    expect(dailyRate(readings, at("2026-03-31"))).toBe(10);
    const due = nextDue({ ...plan, intervalDays: null, intervalMeter: 500, lastDoneMeter: 1000 }, { current: 1300, readings }, at("2026-03-31"));
    expect(due).toEqual({ at: new Date(at("2026-03-31").getTime() + 20 * DAY), meter: 1500, by: "METER" });
  });

  it("takes whichever comes first, and is due now once the meter is past", () => {
    const readings = [
      { reading: 1000, readAt: at("2026-03-01") },
      { reading: 1300, readAt: at("2026-03-31") },
    ];
    const both = { ...plan, intervalDays: 10, intervalMeter: 500, lastDoneAt: at("2026-03-31"), lastDoneMeter: 1000 };
    expect(nextDue(both, { current: 1300, readings }, at("2026-03-31")).by).toBe("DATE");
    expect(nextDue({ ...both, intervalDays: 365 }, { current: 1600, readings }, at("2026-04-02"))).toEqual({ at: at("2026-04-02"), meter: 1500, by: "METER" });
  });

  it("says where a plan stands", () => {
    const now = at("2026-04-01");
    const base = { isActive: true, nextDueMeter: null, leadDays: 7 };
    expect(planState({ ...base, nextDueAt: at("2026-03-30") }, null, false, now)).toBe("OVERDUE");
    expect(planState({ ...base, nextDueAt: at("2026-04-05") }, null, false, now)).toBe("DUE");
    expect(planState({ ...base, nextDueAt: at("2026-05-01") }, null, false, now)).toBe("OK");
    expect(planState({ ...base, nextDueAt: at("2026-03-30") }, null, true, now)).toBe("BOOKED");
    expect(planState({ ...base, nextDueAt: null, nextDueMeter: 500 }, 510, false, now)).toBe("OVERDUE");
    expect(planState({ ...base, isActive: false, nextDueAt: at("2026-03-30") }, null, false, now)).toBe("PAUSED");
  });
});

describe("plans, as stored", () => {
  let shop: TestShop;
  let truckId = "";
  let millId = "";

  beforeAll(async () => {
    shop = await makeTestShop("Maintenance plans");
    const location = await prisma.stockLocation.findFirstOrThrow({ where: { siteId: shop.mainId }, select: { id: true } });
    truckId = (await prisma.equipment.create({ data: { equipmentCode: "T-01", name: "UD truck", category: "VEHICLE", kind: "VEHICLE", meterType: "KM", siteId: shop.mainId, locationId: location.id } })).id;
    millId = (await prisma.equipment.create({ data: { equipmentCode: "M-01", name: "Hammer mill", category: "MILL", siteId: shop.mainId, locationId: location.id } })).id;
  });
  afterAll(async () => {
    if (!shop) return;
    const companyId = shop.companyId;
    await prisma.workOrder.deleteMany({ where: { companyId } });
    await prisma.maintenancePlan.deleteMany({ where: { companyId } });
    await prisma.equipment.deleteMany({ where: { site: { companyId } } });
    await destroyProvisionedTenant(companyId);
  });

  it("refuses a plan that says no interval, or a meter the machine has not got", async () => {
    await expect(createPlan(prisma, { companyId: shop.companyId, userId: shop.owner().userId, equipmentId: millId, name: "Service" })).rejects.toThrow(PlanRefused);
    await expect(createPlan(prisma, { companyId: shop.companyId, userId: shop.owner().userId, equipmentId: millId, name: "Service", intervalMeter: 250 })).rejects.toThrow("has no meter");
  });

  it("moves a meter plan's next due on as the meter climbs", async () => {
    await recordMeterReading({ companyId: shop.companyId, equipmentId: truckId, reading: 10_000, readAt: at("2026-03-01") });
    const plan = await createPlan(prisma, { companyId: shop.companyId, userId: shop.owner().userId, equipmentId: truckId, name: "5,000 km service", intervalMeter: 5000, lastDoneMeter: 10_000, now: at("2026-03-01") });
    expect(Number(plan!.nextDueMeter)).toBe(15_000);
    expect(plan!.nextDueAt).toBeNull();
    await recordMeterReading({ companyId: shop.companyId, equipmentId: truckId, reading: 12_000, readAt: at("2026-03-21") });
    const after = await prisma.maintenancePlan.findUniqueOrThrow({ where: { id: plan!.id } });
    // 2,000 km in 20 days is 100 a day: 3,000 km to go is 30 days.
    expect(after.nextDueAt).toEqual(new Date(at("2026-03-21").getTime() + 30 * DAY));
    expect(after.nextDueBy).toBe("METER");
  });

  it("raises a due service once, and a completed service moves the plan on", async () => {
    const plan = await createPlan(prisma, { companyId: shop.companyId, userId: shop.owner().userId, equipmentId: millId, name: "Quarterly service", tasks: "Grease bearings\nCheck screens", intervalDays: 90, lastDoneAt: at("2026-01-01"), leadDays: 7, now: at("2026-03-20") });
    expect(plan!.nextDueAt).toEqual(at("2026-04-01"));
    expect(await raiseDueServices(prisma, shop.companyId, at("2026-03-01"))).toEqual([]);
    const raised = await raiseDueServices(prisma, shop.companyId, at("2026-03-27"));
    expect(raised).toHaveLength(1);
    const order = await prisma.workOrder.findUniqueOrThrow({ where: { id: raised[0]! } });
    expect(order).toMatchObject({ kind: "PREVENTIVE", planId: plan!.id, status: "OPEN", scheduledFor: at("2026-04-01") });
    expect(order.issue).toContain("Grease bearings");
    expect(await raiseDueServices(prisma, shop.companyId, at("2026-03-28"))).toEqual([]);
    await expect(raiseService(prisma, { companyId: shop.companyId, userId: shop.owner().userId, planId: plan!.id })).rejects.toThrow("booked already");

    await prisma.workOrder.update({ where: { id: order.id }, data: { status: "COMPLETED", downtimeEnd: at("2026-04-02") } });
    const moved = await serviceDone(prisma, { workOrderId: order.id, doneAt: at("2026-04-02") });
    expect(moved!.lastDoneAt).toEqual(at("2026-04-02"));
    expect(moved!.nextDueAt).toEqual(at("2026-07-01"));
  });
});
