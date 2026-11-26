import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MILLING_LOADERS } from "@/extensions/milling/loaders";
import { MILLING_REPORTS } from "@/extensions/milling/reports";
import { prisma } from "@/lib/prisma";

import { ongoingOrder } from "../testing/orders";
import { closeDelivery, dispatchDelivery, loadOrder, planDelivery, recordProofOfDelivery } from "../distribution/deliveries";
import { decideIntake, inspectIntake, recordIntake } from "../intake/intake";
import { completeBatch, issueMaize, recordOutput, recordStage, startBatch } from "../production/batches";
import { recordPackRun } from "../production/packing";
import { decideLot, inspectLot } from "../quality/lots";
import { recordOpeningStock } from "../stock/counts";
import { makeMill, removeMill } from "../testing/fixture";
import { dailyOperations } from "./daily";
import { millDashboard } from "./dashboard";
import { trace, type TraceNode } from "./trace";

let mill: Awaited<ReturnType<typeof makeMill>>;
let intakeCode = "";
let deliveryCode = "";

const who = () => ({ companyId: mill.companyId, userId: mill.userId });
const flatten = (node: TraceNode | null): TraceNode[] => (node ? [node, ...node.children.flatMap(flatten)] : []);

beforeAll(async () => {
  mill = await makeMill("reports");
  // Maize from a supplier, accepted.
  const intake = await recordIntake(prisma, { ...who(), input: { productId: mill.product("MAIZE"), supplierName: "Chirau farm", weighMethod: "BAG_COUNT", bags: 200 } });
  intakeCode = intake.code;
  const maizeSpecs = await prisma.millingQcSpec.findMany({ where: { companyId: mill.companyId, point: "INCOMING_MAIZE" } });
  await inspectIntake(prisma, { ...who(), intakeId: intake.id, results: maizeSpecs.map((spec) => (spec.resultType === "NUMERIC" ? { specId: spec.id, method: "INSTRUMENT" as const, value: 12 } : { specId: spec.id, method: "VISUAL" as const, passed: true })) });
  const accepted = await decideIntake(prisma, { ...who(), intakeId: intake.id, decision: "ACCEPT", binLocationId: mill.location("MZ-STORE") });

  // Milled, inspected, released, packed.
  const batch = await startBatch(prisma, who());
  await issueMaize(prisma, { ...who(), batchId: batch.id, lotId: accepted.lotId!, stockLocationId: mill.location("MZ-STORE"), quantityKg: 10000 });
  for (const stage of await prisma.millingProcessStage.findMany({ where: { companyId: mill.companyId, required: true } })) {
    await recordStage(prisma, { ...who(), batchId: batch.id, input: { stageId: stage.id, startedAt: new Date().toISOString() } });
  }
  await recordOutput(prisma, { ...who(), batchId: batch.id, productId: mill.product("MEAL-BULK"), stockLocationId: mill.location("MEAL-BIN"), quantityKg: 9900 });
  await completeBatch(prisma, { ...who(), batchId: batch.id, inProcessChangeKg: 0 });
  const meal = await prisma.millingLot.findFirstOrThrow({ where: { companyId: mill.companyId, originType: "BATCH" } });
  const productSpecs = await prisma.millingQcSpec.findMany({ where: { companyId: mill.companyId, point: "FINISHED_PRODUCT" } });
  await inspectLot(prisma, { ...who(), lotId: meal.id, results: productSpecs.map((spec) => ({ specId: spec.id, method: "VISUAL" as const, passed: true })) });
  await decideLot(prisma, { ...who(), lotId: meal.id, decision: "RELEASE" });
  await recordOpeningStock(prisma, { ...who(), productId: mill.product("BAG-10"), stockLocationId: mill.location("PKG"), quantity: 500 });
  const recipe = await prisma.millingPackRecipe.findFirstOrThrow({ where: { companyId: mill.companyId, packedProductId: mill.product("MEAL-10") } });
  await recordPackRun(prisma, { ...who(), recipeId: recipe.id, bulkLotId: meal.id, bulkLocationId: mill.location("MEAL-BIN"), outputLocationId: mill.location("FG"), bagsPacked: 300, bulkUsedKg: 3000 });

  // Sold and delivered.
  const customer = await prisma.customer.create({ data: { companyId: mill.companyId, name: "Nyabira Wholesalers" } });
  const order = await ongoingOrder(prisma, { ...who(), customerId: customer.id, lines: [{ productId: mill.product("MEAL-10"), bags: 100, unitPrice: 6.5 }] });
  const truck = await prisma.equipment.findFirstOrThrow({ where: { siteId: mill.siteId, equipmentCode: "UD-2" } });
  const delivery = await planDelivery(prisma, { ...who(), vehicleId: truck.id, driverId: mill.userId });
  deliveryCode = delivery.code;
  await loadOrder(prisma, { ...who(), deliveryId: delivery.id, orderId: order.id });
  await dispatchDelivery(prisma, { ...who(), deliveryId: delivery.id, odometerOut: 100 });
  const lines = await prisma.millingDeliveryLine.findMany({ where: { deliveryId: delivery.id } });
  await recordProofOfDelivery(prisma, { ...who(), deliveryId: delivery.id, canManage: true, receivedBy: "Buyer", lines: lines.map((line) => ({ lineId: line.id, deliveredBags: line.bags })) });
  await closeDelivery(prisma, { ...who(), deliveryId: delivery.id, odometerIn: 160, fuelLitres: 12 });
});

afterAll(async () => {
  await removeMill(mill.companyId);
});

describe("traceability", () => {
  it("follows a customer delivery back to the supplier", async () => {
    const [entry] = await trace(prisma, mill.companyId, deliveryCode);
    const back = flatten(entry.back);
    expect(back.map((node) => node.kind)).toEqual(["lot", "pack", "lot", "batch", "lot", "intake"]);
    expect(back.at(-1)?.label).toContain("Chirau farm");
  });

  it("follows the supplier's delivery forward to the customer", async () => {
    const [entry] = await trace(prisma, mill.companyId, intakeCode);
    const forward = flatten(entry.forward);
    expect(forward.map((node) => node.kind)).toEqual(["lot", "batch", "lot", "pack", "lot", "delivery"]);
    expect(forward.at(-1)?.label).toBe("Nyabira Wholesalers");
  });

  it("says so for a code it does not know", async () => {
    await expect(trace(prisma, mill.companyId, "NOPE-1")).rejects.toThrow("Nothing at the mill");
  });
});

describe("reports", () => {
  it("has a loader for every report, and each loads", async () => {
    expect(Object.keys(MILLING_LOADERS).sort()).toEqual(MILLING_REPORTS.map((report) => report.key).sort());
    const ctx = { companyId: mill.companyId, userId: mill.userId, role: "SUPERADMIN" };
    const today = new Date().toISOString().slice(0, 10);
    for (const report of MILLING_REPORTS) {
      const result = await MILLING_LOADERS[report.key].load(ctx, { from: "2026-01-01", to: today, day: today });
      for (const row of result.rows) {
        const missing = report.columns.filter((column) => !(column.key in row)).map((column) => column.key);
        expect(missing, report.key).toEqual([]);
      }
    }
    const despatch = await MILLING_LOADERS["milling-despatches"].load(ctx, { from: "2026-01-01", to: today });
    expect(despatch.rows[0]).toMatchObject({ customer: "Nyabira Wholesalers", bags: 100, tonnes: 1, value: 650 });
  });

  it("puts the day on one page", async () => {
    const rows = await dailyOperations(prisma, mill.companyId, new Date(Date.now() + 2 * 3_600_000));
    const value = (measure: string) => rows.find((row) => row.measure === measure)?.value;
    expect(value("Deliveries received")).toBe(1);
    expect(value("Maize milled")).toBe(10);
    expect(value("Bags despatched")).toBe(100);
    expect(rows.some((row) => row.section === "Stock now")).toBe(true);
  });

  it("shows the mill now", async () => {
    const dashboard = await millDashboard(prisma, mill.companyId);
    expect(dashboard.packed.find((row) => row.name === "Mealie meal 10 kg")?.bags).toBe(200);
    expect(dashboard.maize.availableKg).toBe(0);
  });
});
