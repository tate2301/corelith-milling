import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";

import { makeMill, removeMill } from "../testing/fixture";
import { currentOpening, goLiveSteps, openingView, postOpening, removeOpeningLine, setOpeningLine } from "./go-live";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

let mill: Awaited<ReturnType<typeof makeMill>>;
const who = () => ({ companyId: mill.companyId, userId: mill.userId });

beforeAll(async () => {
  mill = await makeMill("go-live");
});
afterAll(async () => {
  const where = { companyId: mill.companyId };
  await prisma.journalLine.deleteMany({ where: { entry: where } }).catch(() => undefined);
  await prisma.journalEntry.deleteMany({ where }).catch(() => undefined);
  await prisma.accountingIntegrationEvent.deleteMany({ where }).catch(() => undefined);
  await prisma.millingOpeningStock.deleteMany({ where });
  await removeMill(mill.companyId).catch(() => undefined);
});

describe("go-live", () => {
  it("reads each step's state from what is there", async () => {
    const steps = await goLiveSteps(prisma, mill.companyId);
    expect(steps.map((step) => step.step)).toEqual(["Sites and sections", "Users and roles", "Products and units", "Gate till and ZIMRA", "Opening stock", "Opening debtors", "Pack recipes and specs"]);
    expect(steps.find((step) => step.key === "sites")?.state).toBe("DONE");
    expect(steps.find((step) => step.key === "opening")?.state).toBe("NOT_STARTED");
    expect(steps.find((step) => step.key === "till")?.state).toBe("NOT_STARTED");
  });

  it("counts opening stock, shows the journal it will post, posts it once into lots and Books", async () => {
    const opening = (await currentOpening(prisma, { ...who(), create: true }))!;
    expect(opening.code).toMatch(/^OS-/);
    await expect(setOpeningLine(prisma, { ...who(), openingId: opening.id, productId: mill.product("MAIZE"), stockLocationId: mill.location("MZ-STORE"), quantity: 0, unitCost: 0.285 })).rejects.toThrow("more than nothing");
    await setOpeningLine(prisma, { ...who(), openingId: opening.id, productId: mill.product("MAIZE"), stockLocationId: mill.location("MZ-STORE"), quantity: 84310, unitCost: 0.285 });
    await setOpeningLine(prisma, { ...who(), openingId: opening.id, productId: mill.product("MEAL-10"), stockLocationId: mill.location("FG"), quantity: 1120, unitCost: 3.76 });
    const stray = await setOpeningLine(prisma, { ...who(), openingId: opening.id, productId: mill.product("BAG-10"), stockLocationId: mill.location("PKG"), quantity: 1, unitCost: 1 });
    await removeOpeningLine(prisma, { companyId: mill.companyId, openingId: opening.id, lineId: stray.id });

    const view = await openingView(prisma, { ...who(), openingId: opening.id });
    // 84,310 x 0.285 = 24,028.35; 1,120 x 3.76 = 4,211.20.
    expect(view.total).toBe(28239.55);
    expect(view.journal.reduce((sum, row) => sum + row.debit, 0)).toBeCloseTo(28239.55, 2);
    expect(view.journal.reduce((sum, row) => sum + row.credit, 0)).toBeCloseTo(28239.55, 2);
    expect(view.journalBalanced).toBe(true);

    const { failures } = await postOpening(prisma, { ...who(), openingId: opening.id });
    expect(failures).toEqual([]);
    const meal = await prisma.inventoryItem.findFirstOrThrow({ where: { siteId: mill.siteId, productId: mill.product("MEAL-10") } });
    expect(Number(meal.currentStock)).toBe(1120);
    const lines = await prisma.millingOpeningStockLine.findMany({ where: { openingId: opening.id } });
    expect(lines.every((line) => line.lotId && line.journalEntryId)).toBe(true);
    await expect(postOpening(prisma, { ...who(), openingId: opening.id })).rejects.toThrow("already posted");
    await expect(setOpeningLine(prisma, { ...who(), openingId: opening.id, productId: mill.product("MAIZE"), stockLocationId: mill.location("MZ-STORE"), quantity: 1, unitCost: 1 })).rejects.toThrow("posted");
    expect((await goLiveSteps(prisma, mill.companyId)).find((step) => step.key === "opening")?.state).toBe("DONE");
  });
});
