/**
 * Migration witness for `20261126120000_milling_production_runs`: a run's
 * figures are sane, an item holds one cost treatment, and only the three
 * treatments are stored.
 */
import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

class RolledBack extends Error {}

const refused = async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], write: () => Promise<unknown>) => {
  await tx.$executeRawUnsafe("SAVEPOINT witness");
  const outcome = await write().then(
    () => "stored",
    () => "refused",
  );
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT witness");
  return outcome;
};

describe("production runs and cost treatments, as migrated", () => {
  it("refuses a run of no bags, and a treatment that is not one of the three; one treatment an item", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const run = { companyId: "c", code: "PR-1", productId: "p", recipeId: "r", batchNumber: "B1", producedOn: new Date("2026-11-25"), outputLotId: "l", stockLocationId: "s", recipeInputKg: 10, actualInputKg: 10, yieldVarianceKg: 0, recordedById: "u" };
        expect(await refused(tx, () => tx.millingProductionRun.create({ data: { ...run, bags: 0 } }))).toBe("refused");
        expect(await refused(tx, () => tx.millingProductionRun.create({ data: { ...run, bags: 5 } }))).toBe("stored");
        expect(await refused(tx, () => tx.millingCostTreatment.create({ data: { companyId: "c", productId: "p", treatment: "INVENTORY", setById: "u" } }))).toBe("refused");
        await tx.millingCostTreatment.create({ data: { companyId: "c", productId: "p", treatment: "ASSET", setById: "u" } });
        expect(await refused(tx, () => tx.millingCostTreatment.create({ data: { companyId: "c", productId: "p", treatment: "COST_OF_SALES", setById: "u" } }))).toBe("refused");
        throw new RolledBack();
      }),
    ).rejects.toBeInstanceOf(RolledBack);
  });
});
