import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { makeMill, removeMill } from "@/lib/milling/testing/fixture";
import { createSetting, listSettings, updateSetting } from "./server";

let mill: Awaited<ReturnType<typeof makeMill>>;
let other: Awaited<ReturnType<typeof makeMill>>;
const create = (key: string, body: unknown) => createSetting(prisma, { companyId: mill.companyId, actorId: mill.userId, key, body });
const update = (key: string, id: string, body: unknown) => updateSetting(prisma, { companyId: mill.companyId, actorId: mill.userId, key, id, body });
beforeAll(async () => { mill = await makeMill("setup-create"); other = await makeMill("setup-other"); });
afterAll(async () => { if (mill) await removeMill(mill.companyId); if (other) await removeMill(other.companyId); });

describe("locations and bins", () => {
  it("rolls back both the location and profile if writing its audit fails", async () => {
    const failing = prisma.$extends({ query: { platformAuditEvent: { create: async () => { throw new Error("audit unavailable"); } } } }) as unknown as PrismaClient;
    await expect(createSetting(failing, { companyId: mill.companyId, actorId: mill.userId, key: "locations", body: { siteId: mill.siteId, code: "ROLLBACK", name: "Must not remain", kind: "BIN" } })).rejects.toThrow("audit unavailable");
    expect(await prisma.stockLocation.count({ where: { siteId: mill.siteId, code: "ROLLBACK" } })).toBe(0);
  });

  it("creates the core stock location and mill profile together, and audits the result", async () => {
    const made = await create("locations", { siteId: mill.siteId, code: "new bin", name: "New conditioning bin", kind: "BIN", capacityKg: "12000" });
    const profile = await prisma.millingLocationProfile.findUniqueOrThrow({ where: { id: made.id } });
    expect(profile.kind).toBe("BIN"); expect(profile.capacityKg?.toString()).toBe("12000");
    const core = await prisma.stockLocation.findUniqueOrThrow({ where: { id: profile.stockLocationId } });
    expect(core).toMatchObject({ siteId: mill.siteId, code: "NEW-BIN", name: "New conditioning bin" });
    expect(await prisma.platformAuditEvent.count({ where: { companyId: mill.companyId, entityId: made.id, eventType: "milling.settings.added" } })).toBe(1);
    await expect(create("locations", { siteId: mill.siteId, code: "NEW-BIN", name: "Duplicate", kind: "BIN" })).rejects.toThrow("already used");
    expect(await prisma.stockLocation.count({ where: { siteId: mill.siteId, code: "NEW-BIN" } })).toBe(1);
  });

  it("refuses foreign sites and negative capacity without creating records", async () => {
    await expect(create("locations", { siteId: other.siteId, code: "FOREIGN", name: "Wrong tenant", kind: "BIN" })).rejects.toThrow("workspace");
    await expect(create("locations", { siteId: mill.siteId, code: "NEG", name: "Bad capacity", kind: "BIN", capacityKg: -1 })).rejects.toThrow();
    expect(await prisma.stockLocation.count({ where: { siteId: mill.siteId, code: { in: ["FOREIGN", "NEG"] } } })).toBe(0);
  });

  it("discovers an existing Stores location without a write, and saves its bin details on edit", async () => {
    const core = await prisma.stockLocation.create({ data: { siteId: mill.siteId, code: "EXISTING", name: "Existing Stores bin" } });
    const listed = await listSettings(prisma, mill.companyId, "locations");
    expect(listed.rows.find((row) => row.id === core.id)?.location).toContain("Existing Stores bin");
    expect(await prisma.millingLocationProfile.findUnique({ where: { stockLocationId: core.id } })).toBeNull();
    await update("locations", core.id, { kind: "SILO", capacityKg: 5000 });
    expect(await prisma.millingLocationProfile.findUniqueOrThrow({ where: { stockLocationId: core.id } })).toMatchObject({ companyId: mill.companyId, kind: "SILO" });
    await expect(update("locations", other.location("FG"), { kind: "BIN" })).rejects.toThrow("Not found");
  });
});

describe("pack recipes", () => {
  let packedId: string;
  it("creates a recipe for a new bag product from bulk kg and an optional empty-bag product", async () => {
    packedId = (await prisma.product.create({ data: { companyId: mill.companyId, code: "PACK-20", name: "Meal 20 kg", unit: "BAG", netWeightKg: 20 } })).id;
    const made = await create("recipes", { packedProductId: packedId, bulkProductId: mill.product("MEAL-BULK"), bagProductId: mill.product("BAG-10"), kgPerBag: "20", threadPerBag: "0.001", isActive: true });
    expect(await prisma.millingPackRecipe.findUniqueOrThrow({ where: { id: made.id } })).toMatchObject({ packedProductId: packedId, bulkProductId: mill.product("MEAL-BULK") });
    const listed = await listSettings(prisma, mill.companyId, "recipes");
    expect(listed.rows.find((row) => row.id === made.id)).toMatchObject({ packedProductId: packedId, bulkProductId: mill.product("MEAL-BULK"), kgPerBag: 20 });
    await update("recipes", made.id, { bulkProductId: mill.product("BRAN-BULK"), bagProductId: null });
    expect(await prisma.millingPackRecipe.findUniqueOrThrow({ where: { id: made.id } })).toMatchObject({ bulkProductId: mill.product("BRAN-BULK"), bagProductId: null });
    await expect(create("recipes", { packedProductId: packedId, bulkProductId: mill.product("MEAL-BULK"), kgPerBag: 20 })).rejects.toThrow("already used");
  });

  it("validates product ownership, units and positive kg before persisting", async () => {
    const body = { packedProductId: packedId, bulkProductId: mill.product("MEAL-BULK"), kgPerBag: 20 };
    await expect(create("recipes", { ...body, packedProductId: other.product("MEAL-10") })).rejects.toThrow("workspace");
    await expect(create("recipes", { ...body, bulkProductId: mill.product("BAG-10") })).rejects.toThrow("workspace");
    await expect(create("recipes", { ...body, bagProductId: other.product("BAG-10") })).rejects.toThrow("workspace");
    await expect(create("recipes", { ...body, kgPerBag: 0 })).rejects.toThrow();
    await expect(create("recipes", { ...body, kgPerBag: "" })).rejects.toThrow();
    const recipe = await prisma.millingPackRecipe.findUniqueOrThrow({ where: { packedProductId: packedId } });
    await expect(update("recipes", recipe.id, { bulkProductId: other.product("MEAL-BULK") })).rejects.toThrow("workspace");
    expect((await prisma.millingPackRecipe.findUniqueOrThrow({ where: { id: recipe.id } })).bulkProductId).toBe(mill.product("BRAN-BULK"));
  });
});

it("allows switching off a recipe with an archived product, but not changing it to a foreign source", async () => {
  const packed = await prisma.product.create({ data: { companyId: mill.companyId, code: "OLD-PACK", name: "Old pack", unit: "BAG" } });
  const made = await create("recipes", { packedProductId: packed.id, bulkProductId: mill.product("MEAL-BULK"), kgPerBag: 5 });
  await prisma.product.update({ where: { id: packed.id }, data: { archivedAt: new Date() } });
  await update("recipes", made.id, { isActive: false, bulkProductId: mill.product("MEAL-BULK") });
  expect((await prisma.millingPackRecipe.findUniqueOrThrow({ where: { id: made.id } })).isActive).toBe(false);
  await expect(update("recipes", made.id, { isActive: false, bulkProductId: other.product("MEAL-BULK") })).rejects.toThrow("workspace");
});

describe("quality check setup", () => {
  it("validates numeric limits, supports one-sided bounds, and rejects invalid edits atomically", async () => {
    const body = { point: "INCOMING_MAIZE", code: "TEMP", name: "Temperature", method: "INSTRUMENT", resultType: "NUMERIC", unit: "°C" };
    await expect(create("qc-specs", body)).rejects.toThrow("minimum or maximum");
    await expect(create("qc-specs", { ...body, minValue: 40, maxValue: 10 })).rejects.toThrow("minimum");
    const made = await create("qc-specs", { ...body, maxValue: 40 });
    await expect(update("qc-specs", made.id, { minValue: 50 })).rejects.toThrow("minimum");
    const saved = await prisma.millingQcSpec.findUniqueOrThrow({ where: { id: made.id } });
    expect(saved.minValue).toBeNull(); expect(saved.version).toBe(1);
    await update("qc-specs", made.id, { minValue: 0 });
    expect((await prisma.millingQcSpec.findUniqueOrThrow({ where: { id: made.id } })).version).toBe(2);
  });

  it("clears numeric limits when switching to pass/fail and requires understandable instructions", async () => {
    const made = await create("qc-specs", { point: "FINISHED_PRODUCT", code: "LOOK", name: "Appearance", method: "VISUAL", resultType: "PASS_FAIL", guidance: "No visible lumps", minValue: 1, maxValue: 2, unit: "%" });
    expect(made).toMatchObject({ minValue: null, maxValue: null, unit: null });
    await expect(create("qc-specs", { point: "INCOMING_MAIZE", code: "EMPTY", name: "Unclear", method: "VISUAL", resultType: "PASS_FAIL" })).rejects.toThrow("what a pass looks like");
    const moisture = await prisma.millingQcSpec.findFirstOrThrow({ where: { companyId: mill.companyId, code: "MOISTURE" } });
    await update("qc-specs", moisture.id, { resultType: "PASS_FAIL", guidance: "Sample looks dry" });
    expect(await prisma.millingQcSpec.findUniqueOrThrow({ where: { id: moisture.id } })).toMatchObject({ unit: null, minValue: null, maxValue: null, resultType: "PASS_FAIL", version: 2 });
  });
});
