/**
 * Migration witness for `20261125120000_milling_sell_in_dashboard`: a
 * workspace running the mill loses core's till, its shifts and its portal
 * (it sells from the dashboard); a shop that is not a mill keeps them.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

const MIGRATION = readFileSync(path.join(process.cwd(), "prisma/migrations/20261125120000_milling_sell_in_dashboard/migration.sql"), "utf8");
const KEYS = ["milling.home", "retail.pos", "retail.shifts", "portal.pos", "retail.catalog"] as const;

class RolledBack extends Error {}

describe("selling from the dashboard, as migrated", () => {
  it("switches the till off for mills only, and leaves the rest alone", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const features = Object.fromEntries(
          await Promise.all(
            KEYS.map(async (key) => [key, (await tx.platformFeature.upsert({ where: { key }, update: {}, create: { key, name: key } })).id] as const),
          ),
        );
        const run = Date.now().toString(36);
        const mill = await tx.company.create({ data: { name: `Mill ${run}`, slug: `mill-${run}` } });
        const shop = await tx.company.create({ data: { name: `Shop ${run}`, slug: `shop-${run}` } });
        const flag = (companyId: string, keys: readonly (typeof KEYS)[number][]) =>
          tx.companyFeatureFlag.createMany({ data: keys.map((key) => ({ companyId, featureId: features[key]!, isEnabled: true })) });
        await flag(mill.id, KEYS);
        await flag(shop.id, ["retail.pos", "retail.shifts", "portal.pos", "retail.catalog"]);

        await tx.$executeRawUnsafe(MIGRATION);

        const on = async (companyId: string) =>
          (await tx.companyFeatureFlag.findMany({ where: { companyId, isEnabled: true }, include: { feature: true } })).map((row) => row.feature.key).sort();
        expect(await on(mill.id)).toEqual(["milling.home", "retail.catalog"]);
        expect(await on(shop.id)).toEqual(["portal.pos", "retail.catalog", "retail.pos", "retail.shifts"]);
        throw new RolledBack();
      }),
    ).rejects.toBeInstanceOf(RolledBack);
  });
});
