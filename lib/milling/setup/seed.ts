import type { PrismaClient } from "@prisma/client";

import { MILL_EQUIPMENT, MILL_LOCATIONS, MILL_PRODUCTS, MILL_SITE } from "./mill";

export interface SeedMillResult {
  site: { id: string; created: boolean };
  locationsCreated: number;
  equipmentCreated: number;
  productsCreated: number;
}

type Db = Pick<PrismaClient, "site" | "stockLocation" | "equipment" | "product">;

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
  for (const machine of MILL_EQUIPMENT) {
    const existing = await db.equipment.findUnique({
      where: { siteId_equipmentCode: { siteId: site.id, equipmentCode: machine.code } },
      select: { id: true },
    });
    if (existing) continue;
    const locationId = locationIds.get(machine.location);
    if (!locationId) throw new Error(`Equipment ${machine.code} names an unknown location ${machine.location}.`);
    await db.equipment.create({
      data: { siteId: site.id, locationId, equipmentCode: machine.code, name: machine.name, category: machine.category },
    });
    equipmentCreated += 1;
  }

  let productsCreated = 0;
  for (const product of MILL_PRODUCTS) {
    const existing = await db.product.findUnique({
      where: { companyId_code: { companyId, code: product.code } },
      select: { id: true },
    });
    if (existing) continue;
    await db.product.create({
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
    });
    productsCreated += 1;
  }

  return { site: { id: site.id, created: !existingSite }, locationsCreated, equipmentCreated, productsCreated };
}
