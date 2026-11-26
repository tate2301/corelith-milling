/**
 * Grandmeal's production run (docs/milling/grandmeal-workflow.md, Stage 1)
 * and cost treatments: the recipe comes off stock oldest first, the bags land
 * AVAILABLE under the batch number, actual maize is kept as yield variance, a
 * run that would take an input below zero names it, an untreated input is
 * refused, and the bag's cost is its cost-of-sales inputs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { fuelTreatment, setCostTreatment } from "../books/cost-treatment";
import { recordOpeningStock } from "../stock/counts";
import { makeMill, removeMill } from "../testing/fixture";
import { productByBarcode, recordProductionRun } from "./runs";

let mill: Awaited<ReturnType<typeof makeMill>>;
const who = () => ({ companyId: mill.companyId, userId: mill.userId });
const free = async (code: string) => {
  const rows = await prisma.millingLotBalance.findMany({ where: { companyId: mill.companyId, lot: { productId: mill.product(code) } } });
  return rows.reduce((sum, row) => sum + Number(row.quantity) - Number(row.reserved), 0);
};
const run = (over: Partial<Parameters<typeof recordProductionRun>[1]> = {}) =>
  recordProductionRun(prisma, { ...who(), productId: mill.product("MEAL-10"), bags: 200, batchNumber: "gm-0001", producedOn: "2026-11-25", stockLocationId: mill.location("FG"), ...over });

beforeAll(async () => {
  mill = await makeMill("production-runs");
  // Grandmeal's recipe: maize straight to the bag, 11 kg of maize and one empty bag a 10 kg bag.
  await prisma.millingPackRecipe.update({ where: { packedProductId: mill.product("MEAL-10") }, data: { bulkProductId: mill.product("MAIZE"), kgPerBag: 11, threadPerBag: null } });
  await prisma.product.update({ where: { id: mill.product("MEAL-10") }, data: { barcode: "6009000000101" } });
  await recordOpeningStock(prisma, { ...who(), productId: mill.product("MAIZE"), stockLocationId: mill.location("FG"), quantity: 5000, lotCode: "M-OLD" });
  await recordOpeningStock(prisma, { ...who(), productId: mill.product("BAG-10"), stockLocationId: mill.location("FG"), quantity: 500, lotCode: "B-OLD" });
  const site = mill.siteId;
  await prisma.inventoryItem.updateMany({ where: { siteId: site, productId: mill.product("MAIZE") }, data: { unitCost: 0.3 } });
  await prisma.inventoryItem.updateMany({ where: { siteId: site, productId: mill.product("BAG-10") }, data: { unitCost: 0.2 } });
});
afterAll(async () => {
  await prisma.millingProductionRun.deleteMany({ where: { companyId: mill.companyId } });
  await prisma.millingCostTreatment.deleteMany({ where: { companyId: mill.companyId } });
  await removeMill(mill.companyId);
});

describe("cost treatments", () => {
  it("are set by accounting only, and only on what the mill buys or uses", async () => {
    await expect(setCostTreatment(prisma, { ...who(), mayCost: false, productId: mill.product("MAIZE"), treatment: "COST_OF_SALES" })).rejects.toThrow("Only accounting");
    await expect(setCostTreatment(prisma, { ...who(), mayCost: true, productId: mill.product("MEAL-10"), treatment: "COST_OF_SALES" })).rejects.toThrow("finished bag");
  });

  it("follow the machine for fuel: a truck is an expense, the mill and the generator cost of sales", () => {
    expect(fuelTreatment({ kind: "VEHICLE", category: "VEHICLE" })).toBe("OPERATING_EXPENSE");
    expect(fuelTreatment({ kind: "MACHINE", category: "ROLLER_MILL" })).toBe("COST_OF_SALES");
    expect(fuelTreatment({ kind: "MACHINE", category: "GENERATOR" })).toBe("COST_OF_SALES");
  });
});

describe("a production run", () => {
  it("finds the product by its barcode", async () => {
    expect((await productByBarcode(prisma, mill.companyId, "6009000000101"))?.id).toBe(mill.product("MEAL-10"));
    expect(await productByBarcode(prisma, mill.companyId, "nothing")).toBeNull();
  });

  it("is refused while an input has no cost treatment, naming it", async () => {
    await expect(run()).rejects.toThrow("Accounting sets the cost treatment of White maize (grain), Empty bag, 10 kg");
    await setCostTreatment(prisma, { ...who(), mayCost: true, productId: mill.product("MAIZE"), treatment: "COST_OF_SALES" });
    await setCostTreatment(prisma, { ...who(), mayCost: true, productId: mill.product("BAG-10"), treatment: "COST_OF_SALES" });
  });

  it("takes the recipe off stock and lands the bags AVAILABLE under the batch, costed", async () => {
    const recorded = await run();
    expect(recorded).toMatchObject({ batchNumber: "GM-0001", bags: 200 });
    expect([Number(recorded.recipeInputKg), Number(recorded.actualInputKg), Number(recorded.yieldVarianceKg)]).toEqual([2200, 2200, 0]);
    expect(Number(recorded.bagCost)).toBeCloseTo((2200 * 0.3 + 200 * 0.2) / 200, 4);
    expect([await free("MAIZE"), await free("BAG-10"), await free("MEAL-10")]).toEqual([2800, 300, 200]);
    const lot = await prisma.millingLot.findFirstOrThrow({ where: { companyId: mill.companyId, code: "GM-0001" } });
    expect([lot.status, lot.originType, lot.producedAt.toISOString().slice(0, 10)]).toEqual(["AVAILABLE", "RUN", "2026-11-25"]);
  });

  it("keeps the maize actually used, and the difference as yield variance", async () => {
    await setCostTreatment(prisma, { ...who(), mayCost: true, productId: mill.product("BAG-10"), treatment: "ASSET" });
    const recorded = await run({ batchNumber: "GM-0002", bags: 100, actualInputKg: 1150 });
    expect([Number(recorded.recipeInputKg), Number(recorded.actualInputKg), Number(recorded.yieldVarianceKg)]).toEqual([1100, 1150, 50]);
    // The bag is an asset now: only the maize is in the bag's cost.
    expect(Number(recorded.bagCost)).toBeCloseTo((1150 * 0.3) / 100, 4);
    expect(await free("MAIZE")).toBe(1650);
  });

  it("will not reuse a batch number, or post an input below zero", async () => {
    await expect(run({ batchNumber: "GM-0001" })).rejects.toThrow("already recorded");
    await expect(run({ batchNumber: "GM-0003", bags: 1000 })).rejects.toThrow("Not enough White maize (grain): 1650 free, 11000 needed. Stores fixes the receipt first.");
    expect(await free("MAIZE")).toBe(1650);
    await expect(run({ batchNumber: "GM-0004", producedOn: "2999-01-01" })).rejects.toThrow("today or earlier");
  });
});
