import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { MILL_DESTINATIONS, MILL_EQUIPMENT, MILL_LOCATIONS, MILL_PRODUCTS, MILL_QC_SPECS, MILL_STAGES } from "./mill";
import { seedMill } from "./seed";

const run = Date.now().toString(36);
let companyId = "";

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: `Seed ${run}`, slug: `seed-${run}`, tenantStatus: "ACTIVE" } })).id;
});

afterAll(async () => {
  const where = { companyId };
  await prisma.millingPackRecipe.deleteMany({ where });
  await prisma.millingVehicleProfile.deleteMany({ where });
  await prisma.millingShiftDuty.deleteMany({ where });
  await prisma.millingDestination.deleteMany({ where });
  await prisma.millingQcSpec.deleteMany({ where });
  await prisma.millingProcessStage.deleteMany({ where });
  await prisma.millingLocationProfile.deleteMany({ where });
  await prisma.millingSettings.deleteMany({ where });
  await prisma.product.deleteMany({ where });
  const sites = await prisma.site.findMany({ where, select: { id: true } });
  const siteIds = sites.map((site) => site.id);
  await prisma.equipment.deleteMany({ where: { siteId: { in: siteIds } } });
  await prisma.stockLocation.deleteMany({ where: { siteId: { in: siteIds } } });
  await prisma.site.deleteMany({ where });
  await prisma.company.delete({ where: { id: companyId } });
});

describe("seeding a mill", () => {
  it("creates the plant, the products and the settings, then nothing on a second run", async () => {
    const first = await seedMill(prisma, companyId);
    expect(first.site.created).toBe(true);
    expect(first.locationsCreated).toBe(MILL_LOCATIONS.length);
    expect(first.equipmentCreated).toBe(MILL_EQUIPMENT.length);
    expect(first.productsCreated).toBe(MILL_PRODUCTS.length);
    expect(first.settingsCreated).toBeGreaterThan(0);

    const second = await seedMill(prisma, companyId);
    expect(second).toMatchObject({ locationsCreated: 0, equipmentCreated: 0, productsCreated: 0, settingsCreated: 0 });
    expect(second.site).toEqual({ id: first.site.id, created: false });
  });

  it("gives the mill its route, checks, destinations, recipes and fleet", async () => {
    const stages = await prisma.millingProcessStage.findMany({ where: { companyId }, orderBy: { sequence: "asc" } });
    expect(stages.map((stage) => stage.code)).toEqual(MILL_STAGES.map((stage) => stage.code));
    expect(await prisma.millingQcSpec.count({ where: { companyId } })).toBe(MILL_QC_SPECS.length);
    expect(await prisma.millingDestination.count({ where: { companyId } })).toBe(MILL_DESTINATIONS.length);
    expect(await prisma.millingVehicleProfile.count({ where: { companyId } })).toBe(3);

    const meal10 = await prisma.product.findUniqueOrThrow({ where: { companyId_code: { companyId, code: "MEAL-10" } } });
    const recipe = await prisma.millingPackRecipe.findUniqueOrThrow({ where: { packedProductId: meal10.id } });
    expect(Number(recipe.kgPerBag)).toBe(10);

    const settings = await prisma.millingSettings.findUniqueOrThrow({ where: { companyId } });
    expect(Number(settings.shiftHours)).toBe(8.5);
    expect(settings.shiftCrewSize).toBe(7);
  });

  it("keeps a setting the mill has changed", async () => {
    await prisma.millingDestination.update({
      where: { companyId_code: { companyId, code: "MAZOWE" } },
      data: { name: "Mazowe depot" },
    });
    await seedMill(prisma, companyId);
    const mazowe = await prisma.millingDestination.findUniqueOrThrow({ where: { companyId_code: { companyId, code: "MAZOWE" } } });
    expect(mazowe.name).toBe("Mazowe depot");
  });
});
