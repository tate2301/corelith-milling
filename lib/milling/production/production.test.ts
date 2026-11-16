import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { decideAndApply } from "../exceptions/decide";
import { reportDowntime, releaseMachine, recordGeneratorRun } from "../maintenance/equipment";
import { decideLot, inspectLot } from "../quality/lots";
import { recordOpeningStock } from "../stock/counts";
import { makeEmployee, makeMill, removeMill } from "../testing/fixture";
import { completeBatch, issueMaize, materialBalance, recordOutput, recordStage, startBatch } from "./batches";
import { approveOrder, createOrder, submitOrder } from "./orders";
import { checkWeightSummary, recordPackRun } from "./packing";
import { approveShift, closeShift, millDate, millTime, openShift, overtimeHours, planShift } from "./shifts";

let mill: Awaited<ReturnType<typeof makeMill>>;
beforeAll(async () => {
  mill = await makeMill("production");
});
afterAll(async () => {
  await removeMill(mill.companyId);
});

const who = () => ({ companyId: mill.companyId, userId: mill.userId });

describe("the rules", () => {
  it("balances a batch's material", () => {
    const balance = materialBalance({ maizeKg: 10000, waterKg: 300, outputKg: 9600, separatedKg: 400, inProcessChangeKg: 100 });
    expect(Number(balance.unaccountedKg)).toBe(200);
    expect(Number(balance.variancePct)).toBeCloseTo(1.942, 2);
  });

  it("puts a night shift on the day it started, and works out overtime against 8.5 hours", () => {
    const start = millTime("2026-11-16", "22:00");
    expect(start.toISOString()).toBe("2026-11-16T20:00:00.000Z");
    expect(millDate(new Date(start.getTime() + 4 * 3_600_000)).toISOString().slice(0, 10)).toBe("2026-11-17");
    expect(millDate(start).toISOString().slice(0, 10)).toBe("2026-11-16");
    expect(overtimeHours({ clockIn: start, clockOut: new Date(start.getTime() + 10 * 3_600_000), breakMinutes: 30, shiftHours: 8.5 })).toBe(1);
    expect(overtimeHours({ clockIn: start, clockOut: new Date(start.getTime() + 6 * 3_600_000), breakMinutes: 0, shiftHours: 8.5 })).toBe(0);
  });

  it("summarises check weights", () => {
    expect(checkWeightSummary([10.05, 10.1, 9.95], 10)).toEqual({ samples: 3, averageKg: 10.033, giveawayPerBagKg: 0.033, under: 1 });
  });
});

describe("a night's production, end to end", () => {
  it("plans, staffs, mills, reconciles, inspects and packs", async () => {
    const maize = await recordOpeningStock(prisma, { ...who(), productId: mill.product("MAIZE"), stockLocationId: mill.location("MZ-STORE"), quantity: 20000, unitCost: 0.32 });
    await recordOpeningStock(prisma, { ...who(), productId: mill.product("BAG-10"), stockLocationId: mill.location("PKG"), quantity: 1000 });

    // Plan: 500 bags of 10 kg meal. Needs 5000 / 0.97 = 5155 kg maize, reserved on approval.
    const order = await createOrder(prisma, { ...who(), productionDate: "2026-11-16", shiftKind: "NIGHT", lines: [{ productId: mill.product("MEAL-10"), bags: 500 }] });
    await expect(approveOrder(prisma, { ...who(), orderId: order.id })).rejects.toThrow("submitted");
    await submitOrder(prisma, { ...who(), orderId: order.id });
    const approved = await approveOrder(prisma, { ...who(), orderId: order.id });
    expect(Number(approved.maizeNeededKg)).toBe(5155);
    const reserved = await prisma.millingLotBalance.findFirstOrThrow({ where: { lotId: maize.id } });
    expect(Number(reserved.reserved)).toBe(5155);

    // Shift: two of the crew, night, 22:00.
    const [rudo, farai] = [await makeEmployee(mill.companyId, "Rudo"), await makeEmployee(mill.companyId, "Farai")];
    const shift = await planShift(prisma, { ...who(), date: "2026-11-16", kind: "NIGHT", startTime: "22:00", crew: [{ employeeId: rudo.id }, { employeeId: farai.id }] });
    expect(shift.code).toBe("SH-261116-N");
    await openShift(prisma, { ...who(), shiftId: shift.id, at: millTime("2026-11-16", "22:00") });

    // Batch: 6000 kg issued, the order's 5155 first.
    const batch = await startBatch(prisma, { ...who(), orderId: order.id, shiftId: shift.id });
    await issueMaize(prisma, { ...who(), batchId: batch.id, lotId: maize.id, stockLocationId: mill.location("MZ-STORE"), quantityKg: 6000 });
    expect((await prisma.millingReservation.findFirstOrThrow({ where: { sourceId: order.id } })).status).toBe("FULFILLED");
    expect(Number((await prisma.millingBatch.findUniqueOrThrow({ where: { id: batch.id } })).maizeCost)).toBe(1920);

    // A breakdown on DEG-1 stops it being used until released.
    const deg1 = await prisma.equipment.findFirstOrThrow({ where: { siteId: mill.siteId, equipmentCode: "DEG-1" } });
    await reportDowntime(prisma, { ...who(), equipmentId: deg1.id, category: "BREAKDOWN", cause: "Bearing seized", batchId: batch.id, shiftId: shift.id, stageCode: "DEGERM" });
    const stages = await prisma.millingProcessStage.findMany({ where: { companyId: mill.companyId }, orderBy: { sequence: "asc" } });
    const at = (hour: string) => millTime("2026-11-16", hour).toISOString();
    const degerm = stages.find((stage) => stage.code === "DEGERM")!;
    await expect(recordStage(prisma, { ...who(), batchId: batch.id, input: { stageId: degerm.id, startedAt: at("23:00") } })).rejects.toThrow("DEG-1 is not released");
    await releaseMachine(prisma, { ...who(), equipmentId: deg1.id, note: "Bearing replaced" });
    expect((await prisma.workOrder.findFirstOrThrow({ where: { equipmentId: deg1.id } })).status).toBe("COMPLETED");

    for (const stage of stages.filter((entry) => entry.required)) {
      await recordStage(prisma, {
        ...who(),
        batchId: batch.id,
        input: {
          stageId: stage.id,
          startedAt: at("23:00"),
          removedKg: stage.code === "PRECLEAN" ? 60 : stage.code === "DESTONE" ? 20 : null,
          waterLitres: stage.code === "CONDITION" ? 180 : null,
          moistureAfterPct: stage.code === "CONDITION" ? 15.5 : null,
        },
      });
    }

    // Outputs well short of the input: the balance is out of tolerance.
    await recordOutput(prisma, { ...who(), batchId: batch.id, productId: mill.product("MEAL-BULK"), stockLocationId: mill.location("MEAL-BIN"), quantityKg: 4300 });
    await recordOutput(prisma, { ...who(), batchId: batch.id, productId: mill.product("BRAN-BULK"), stockLocationId: mill.location("BRAN"), quantityKg: 900 });
    await recordOutput(prisma, { ...who(), batchId: batch.id, productId: mill.product("GEM-BULK"), stockLocationId: mill.location("GEM"), quantityKg: 400 });
    const waiting = await completeBatch(prisma, { ...who(), batchId: batch.id, inProcessChangeKg: 150 });
    expect(waiting.status).toBe("AWAITING_DECISION");
    expect(Number(waiting.unaccountedKg)).toBe(6180 - 5600 - 80 - 150);
    await expect(completeBatch(prisma, { ...who(), batchId: batch.id })).rejects.toThrow("Waiting on a decision");

    const variance = await prisma.millingException.findFirstOrThrow({ where: { targetId: batch.id, type: "RECONCILIATION_VARIANCE" } });
    await decideAndApply(prisma, { companyId: mill.companyId, deciderId: mill.userId, exceptionId: variance.id, decision: "ACCEPT_VARIANCE", note: "Spillage at the meal auger, cleaned up" });
    const done = await completeBatch(prisma, { ...who(), batchId: batch.id });
    expect(done.status).toBe("COMPLETED");
    expect((done.yields as Record<string, number>)["MEAL-BULK"]).toBeCloseTo(71.67, 1);
    expect((await prisma.millingProductionOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("COMPLETED");

    // Product QC: one test not performed blocks release until overridden.
    const mealLot = await prisma.millingLot.findFirstOrThrow({ where: { companyId: mill.companyId, code: `${batch.code}-MEAL-BULK` } });
    expect(mealLot.status).toBe("HOLD");
    const specs = await prisma.millingQcSpec.findMany({ where: { companyId: mill.companyId, point: "FINISHED_PRODUCT" } });
    await inspectLot(prisma, {
      ...who(),
      lotId: mealLot.id,
      results: specs.map((spec) => (spec.code === "GRANULATION" ? { specId: spec.id, method: "NOT_PERFORMED" as const } : { specId: spec.id, method: "VISUAL" as const, passed: true })),
    });
    await expect(decideLot(prisma, { ...who(), lotId: mealLot.id, decision: "RELEASE" })).rejects.toThrow("Waiting on a decision");
    const notDone = await prisma.millingException.findFirstOrThrow({ where: { targetId: mealLot.id, type: "QC_NOT_PERFORMED" } });
    await decideAndApply(prisma, { companyId: mill.companyId, deciderId: mill.userId, exceptionId: notDone.id, decision: "RELEASE_ANYWAY", note: "Sieve broken; feel test fine" });
    expect((await decideLot(prisma, { ...who(), lotId: mealLot.id, decision: "RELEASE" })).status).toBe("AVAILABLE");

    // Pack 400 bags with 4 damaged, using 4012 kg: 12 kg giveaway.
    const recipe = await prisma.millingPackRecipe.findFirstOrThrow({ where: { companyId: mill.companyId, packedProductId: mill.product("MEAL-10") } });
    const run = await recordPackRun(prisma, {
      ...who(),
      recipeId: recipe.id,
      bulkLotId: mealLot.id,
      bulkLocationId: mill.location("MEAL-BIN"),
      outputLocationId: mill.location("FG"),
      bagsPacked: 400,
      damagedBags: 4,
      bulkUsedKg: 4012,
      checkWeights: [10.02, 10.05, 9.98],
      shiftId: shift.id,
    });
    expect(Number(run.varianceKg)).toBe(12);
    const packed = await prisma.millingLot.findFirstOrThrow({ where: { id: run.outputLotId }, include: { balances: true } });
    expect([packed.status, Number(packed.balances[0].quantity)]).toEqual(["AVAILABLE", 400]);
    const bags = await prisma.millingLotBalance.findFirstOrThrow({ where: { lot: { productId: mill.product("BAG-10") } } });
    expect(Number(bags.quantity)).toBe(596);

    // Close at 07:30: 9.5 h less a 30 min break is 9 h, half an hour over.
    await prisma.millingShiftAssignment.updateMany({ where: { shiftId: shift.id }, data: { breakMinutes: 30 } });
    await closeShift(prisma, { ...who(), shiftId: shift.id, materialInProcessKg: 150, at: millTime("2026-11-17", "07:30") });
    await approveShift(prisma, { ...who(), shiftId: shift.id });
    const attendance = await prisma.attendance.findMany({ where: { companyId: mill.companyId } });
    expect(attendance).toHaveLength(2);
    expect(attendance[0]).toMatchObject({ shift: "NIGHT", status: "PRESENT", overtime: 0.5 });
    expect(attendance[0].date.toISOString().slice(0, 10)).toBe("2026-11-16");

    // Generator run during the outage.
    await recordGeneratorRun(prisma, { ...who(), startedAt: millTime("2026-11-17", "01:00"), endedAt: millTime("2026-11-17", "03:00"), litres: 46, reason: "ZESA outage" });
  });
});
