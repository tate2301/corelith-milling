import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { seedMill } from "../setup/seed";
import { SETTINGS_RESOURCES } from "./fields";
import {
  createSetting,
  getGeneralSettings,
  listSettings,
  MillSettingsError,
  updateGeneralSettings,
  updateSetting,
} from "./server";

const run = Date.now().toString(36);
let companyId = "";
let otherCompanyId = "";
let actorId = "";

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: `Set ${run}`, slug: `set-${run}`, tenantStatus: "ACTIVE" } })).id;
  otherCompanyId = (await prisma.company.create({ data: { name: `Set2 ${run}`, slug: `set2-${run}`, tenantStatus: "ACTIVE" } })).id;
  actorId = (await prisma.user.create({ data: { name: "Admin", email: `admin-${run}@x.test`, role: "SUPERADMIN", companyId } })).id;
  await seedMill(prisma, companyId);
});

afterAll(async () => {
  for (const id of [companyId, otherCompanyId]) {
    const where = { companyId: id };
    await prisma.millingPackRecipe.deleteMany({ where });
    await prisma.millingVehicleProfile.deleteMany({ where });
    await prisma.millingShiftDuty.deleteMany({ where });
    await prisma.millingDestination.deleteMany({ where });
    await prisma.millingQcSpec.deleteMany({ where });
    await prisma.millingProcessStage.deleteMany({ where });
    await prisma.millingLocationProfile.deleteMany({ where });
    await prisma.millingSettings.deleteMany({ where });
    await prisma.platformAuditEvent.deleteMany({ where });
    await prisma.product.deleteMany({ where });
    const siteIds = (await prisma.site.findMany({ where, select: { id: true } })).map((site) => site.id);
    await prisma.equipment.deleteMany({ where: { siteId: { in: siteIds } } });
    await prisma.stockLocation.deleteMany({ where: { siteId: { in: siteIds } } });
    await prisma.site.deleteMany({ where });
    await prisma.user.deleteMany({ where });
    await prisma.company.delete({ where: { id } });
  }
});

describe("the mill's settings", () => {
  it("lists every resource for a seeded mill", async () => {
    for (const resource of SETTINGS_RESOURCES) {
      const list = await listSettings(prisma, companyId, resource.key);
      expect(list.rows.length, resource.key).toBeGreaterThan(0);
    }
  });

  it("adds a destination, refuses its code twice, and records the change", async () => {
    const row = await createSetting(prisma, { companyId, actorId, key: "destinations", body: { code: "glen view", name: "Glen View", distanceKm: "41.5", isActive: true } });
    expect(row.code).toBe("GLEN-VIEW");
    await expect(
      createSetting(prisma, { companyId, actorId, key: "destinations", body: { code: "GLEN-VIEW", name: "Again", isActive: true } }),
    ).rejects.toThrow("already used");
    expect(await prisma.platformAuditEvent.count({ where: { companyId, eventType: "milling.settings.added", entityId: row.id } })).toBe(1);
  });

  it("refuses a code change, an unknown field and a bad number", async () => {
    const { rows } = await listSettings(prisma, companyId, "destinations");
    await expect(updateSetting(prisma, { companyId, actorId, key: "destinations", id: rows[0].id, body: { code: "NEW" } })).rejects.toBeInstanceOf(MillSettingsError);
    await expect(updateSetting(prisma, { companyId, actorId, key: "destinations", id: rows[0].id, body: { distanceKm: "far" } })).rejects.toThrow("number");
  });

  it("starts a new version of a check when its rule changes, not when its words do", async () => {
    const { rows } = await listSettings(prisma, companyId, "qc-specs");
    const moisture = rows.find((row) => row.code === "MOISTURE")!;
    await updateSetting(prisma, { companyId, actorId, key: "qc-specs", id: moisture.id, body: { guidance: "Use the meter." } });
    expect((await prisma.millingQcSpec.findUniqueOrThrow({ where: { id: moisture.id } })).version).toBe(1);
    await updateSetting(prisma, { companyId, actorId, key: "qc-specs", id: moisture.id, body: { maxValue: "13" } });
    expect((await prisma.millingQcSpec.findUniqueOrThrow({ where: { id: moisture.id } })).version).toBe(2);
  });

  it("only lets a vehicle be given a driver from the workspace", async () => {
    const { rows, options } = await listSettings(prisma, companyId, "vehicles");
    expect(options.driverUserId.map((option) => option.value)).toContain(actorId);
    const stranger = await prisma.user.create({ data: { name: "Stranger", email: `s-${run}@x.test`, role: "CLERK", companyId: otherCompanyId } });
    await expect(
      updateSetting(prisma, { companyId, actorId, key: "vehicles", id: rows[0].id, body: { driverUserId: stranger.id } }),
    ).rejects.toThrow("not in this workspace");
    await updateSetting(prisma, { companyId, actorId, key: "vehicles", id: rows[0].id, body: { driverUserId: actorId, capacityKg: "8000", registrationNumber: "AEZ 1234" } });
  });

  it("will not touch another workspace's row", async () => {
    const { rows } = await listSettings(prisma, companyId, "duties");
    await expect(
      updateSetting(prisma, { companyId: otherCompanyId, actorId, key: "duties", id: rows[0].id, body: { name: "Hijacked" } }),
    ).rejects.toThrow("Not found");
  });

  it("keeps the shift template and tolerances", async () => {
    expect(await getGeneralSettings(prisma, companyId)).toEqual({
      reconciliationTolerancePct: 2,
      defaultIntakeBagKg: 50,
      shiftHours: 8.5,
      shiftCrewSize: 7,
      sellerMaxDiscount: 1,
      sellerDiscountStep: 0.1,
    });
    const saved = await updateGeneralSettings(prisma, { companyId, actorId, body: { reconciliationTolerancePct: "1.5" } });
    expect(saved.reconciliationTolerancePct).toBe(1.5);
  });
});
