import type { PrismaClient } from "@prisma/client";

import {
  MILL_DESTINATIONS,
  MILL_EQUIPMENT,
  MILL_LOCATIONS,
  MILL_PACK_RECIPES,
  MILL_PRODUCTS,
  MILL_QC_SPECS,
  MILL_SHIFT_DUTIES,
  MILL_SITE,
  MILL_STAGES,
} from "./mill";

export interface SeedMillResult {
  site: { id: string; created: boolean };
  locationsCreated: number;
  equipmentCreated: number;
  productsCreated: number;
  /** Settings rows added: stages, QC checks, destinations, duties, recipes, location and vehicle profiles. */
  settingsCreated: number;
}

type Db = Pick<
  PrismaClient,
  | "site"
  | "stockLocation"
  | "equipment"
  | "product"
  | "millingSettings"
  | "millingLocationProfile"
  | "millingProcessStage"
  | "millingQcSpec"
  | "millingDestination"
  | "millingVehicleProfile"
  | "millingShiftDuty"
  | "millingPackRecipe"
>;

/**
 * Give a milling workspace its mill (`./mill.ts`).
 *
 * Creates what is missing and never changes what exists: a second run, or a
 * run after the mill has renamed a bin or repriced a bag, changes nothing.
 * Every row is keyed on its code (site per company, location and equipment per
 * site, product per company).
 */
export async function seedMill(db: Db, companyId: string): Promise<SeedMillResult> {
  const existingSite = await db.site.findFirst({
    where: { companyId, code: MILL_SITE.code },
    select: { id: true },
  });
  const site =
    existingSite ??
    (await db.site.create({
      data: { companyId, code: MILL_SITE.code, name: MILL_SITE.name, location: MILL_SITE.location, measurementUnit: "tonnes" },
      select: { id: true },
    }));

  const locationIds = new Map<string, string>();
  let locationsCreated = 0;
  for (const [index, location] of MILL_LOCATIONS.entries()) {
    const existing = await db.stockLocation.findUnique({
      where: { siteId_code: { siteId: site.id, code: location.code } },
      select: { id: true },
    });
    const row =
      existing ??
      (await db.stockLocation.create({
        data: { siteId: site.id, code: location.code, name: location.name, sortOrder: index },
        select: { id: true },
      }));
    if (!existing) locationsCreated += 1;
    locationIds.set(location.code, row.id);
  }

  let equipmentCreated = 0;
  const equipmentIds = new Map<string, string>();
  for (const machine of MILL_EQUIPMENT) {
    const existing = await db.equipment.findUnique({
      where: { siteId_equipmentCode: { siteId: site.id, equipmentCode: machine.code } },
      select: { id: true },
    });
    if (existing) {
      equipmentIds.set(machine.code, existing.id);
      continue;
    }
    const locationId = locationIds.get(machine.location);
    if (!locationId) throw new Error(`Equipment ${machine.code} names an unknown location ${machine.location}.`);
    const created = await db.equipment.create({
      data: { siteId: site.id, locationId, equipmentCode: machine.code, name: machine.name, category: machine.category },
      select: { id: true },
    });
    equipmentIds.set(machine.code, created.id);
    equipmentCreated += 1;
  }

  let productsCreated = 0;
  const productIds = new Map<string, string>();
  for (const product of MILL_PRODUCTS) {
    const existing = await db.product.findUnique({
      where: { companyId_code: { companyId, code: product.code } },
      select: { id: true },
    });
    if (existing) {
      productIds.set(product.code, existing.id);
      continue;
    }
    const created = await db.product.create({
      data: {
        companyId,
        code: product.code,
        name: product.name,
        kind: product.kind,
        unit: product.unit,
        unitLabel: product.unitLabel,
        netWeightKg: product.netWeightKg,
        category: product.category,
      },
      select: { id: true },
    });
    productIds.set(product.code, created.id);
    productsCreated += 1;
  }

  const settingsCreated = await seedMillSettings(db, companyId, { locationIds, equipmentIds, productIds });

  return {
    site: { id: site.id, created: !existingSite },
    locationsCreated,
    equipmentCreated,
    productsCreated,
    settingsCreated,
  };
}

/** Counts a row as created only when it was missing; never changes one that exists. */
async function ensure(exists: () => Promise<unknown>, create: () => Promise<unknown>): Promise<number> {
  if (await exists()) return 0;
  await create();
  return 1;
}

async function seedMillSettings(
  db: Db,
  companyId: string,
  ids: { locationIds: Map<string, string>; equipmentIds: Map<string, string>; productIds: Map<string, string> },
): Promise<number> {
  let created = 0;
  const id = (map: Map<string, string>, code: string) => {
    const value = map.get(code);
    if (!value) throw new Error(`The mill names ${code}, which the seed did not find.`);
    return value;
  };

  created += await ensure(
    () => db.millingSettings.findUnique({ where: { companyId } }),
    () => db.millingSettings.create({ data: { companyId } }),
  );

  for (const location of MILL_LOCATIONS) {
    const stockLocationId = id(ids.locationIds, location.code);
    created += await ensure(
      () => db.millingLocationProfile.findUnique({ where: { stockLocationId } }),
      () => db.millingLocationProfile.create({ data: { companyId, stockLocationId, kind: location.kind } }),
    );
  }

  for (const [index, stage] of MILL_STAGES.entries()) {
    created += await ensure(
      () => db.millingProcessStage.findUnique({ where: { companyId_code: { companyId, code: stage.code } } }),
      () =>
        db.millingProcessStage.create({
          data: {
            companyId,
            code: stage.code,
            name: stage.name,
            sequence: (index + 1) * 10,
            required: stage.required,
            capturesQuantities: stage.capturesQuantities,
            equipmentCodes: stage.equipment,
          },
        }),
    );
  }

  for (const spec of MILL_QC_SPECS) {
    created += await ensure(
      () =>
        db.millingQcSpec.findUnique({
          where: { companyId_point_code: { companyId, point: spec.point, code: spec.code } },
        }),
      () =>
        db.millingQcSpec.create({
          data: {
            companyId,
            point: spec.point,
            code: spec.code,
            name: spec.name,
            method: spec.method,
            resultType: spec.resultType,
            unit: spec.unit,
            maxValue: spec.maxValue,
            guidance: spec.guidance,
          },
        }),
    );
  }

  for (const destination of MILL_DESTINATIONS) {
    created += await ensure(
      () => db.millingDestination.findUnique({ where: { companyId_code: { companyId, code: destination.code } } }),
      () => db.millingDestination.create({ data: { companyId, ...destination } }),
    );
  }

  for (const [index, duty] of MILL_SHIFT_DUTIES.entries()) {
    created += await ensure(
      () => db.millingShiftDuty.findUnique({ where: { companyId_code: { companyId, code: duty.code } } }),
      () => db.millingShiftDuty.create({ data: { companyId, ...duty, sortOrder: index } }),
    );
  }

  for (const machine of MILL_EQUIPMENT.filter((entry) => entry.category === "VEHICLE")) {
    const equipmentId = id(ids.equipmentIds, machine.code);
    created += await ensure(
      () => db.millingVehicleProfile.findUnique({ where: { equipmentId } }),
      () => db.millingVehicleProfile.create({ data: { companyId, equipmentId } }),
    );
  }

  for (const recipe of MILL_PACK_RECIPES) {
    const packed = MILL_PRODUCTS.find((product) => product.code === recipe.packed);
    if (!packed?.netWeightKg) throw new Error(`Pack recipe ${recipe.packed} needs a packed product with a net weight.`);
    const packedProductId = id(ids.productIds, recipe.packed);
    created += await ensure(
      () => db.millingPackRecipe.findUnique({ where: { packedProductId } }),
      () =>
        db.millingPackRecipe.create({
          data: {
            companyId,
            packedProductId,
            bulkProductId: id(ids.productIds, recipe.bulk),
            bagProductId: id(ids.productIds, recipe.bag),
            kgPerBag: packed.netWeightKg!,
          },
        }),
    );
  }

  return created;
}
