import type { PrismaClient } from "@prisma/client";

import { millDay } from "../sellers/trips";
import { millDayWindow } from "./daily";
import { yesterdayBySite } from "./home";

/**
 * The director's Overview on a phone (HM-B1): yesterday across the sites in
 * five figures (maize received, meal made, extraction, hours stopped, bags
 * out), then each site, and a warning when extraction fell short of the
 * mill's target.
 *
 * Extraction is meal made out of the maize the day's completed runs used.
 */
export async function directorDay(db: PrismaClient, companyId: string, now: Date = new Date()) {
  const sites = await yesterdayBySite(db, companyId, now);
  const yesterday = new Date(millDay(now).getTime() - 86_400_000);
  const window = millDayWindow(yesterday);
  const [batches, meal, settings] = await Promise.all([
    db.millingBatch.findMany({ where: { companyId, completedAt: window }, include: { outputs: true } }),
    db.product.findMany({ where: { companyId, code: { startsWith: "MEAL" } }, select: { id: true } }),
    db.millingSettings.findUnique({ where: { companyId }, select: { extractionTargetPct: true } }),
  ]);
  const mealIds = new Set(meal.map((row) => row.id));
  const maizeIn = batches.reduce((sum, batch) => sum + Number(batch.maizeIssuedKg), 0);
  const mealOut = batches.flatMap((batch) => batch.outputs).filter((row) => mealIds.has(row.productId)).reduce((sum, row) => sum + Number(row.quantityKg), 0);
  const extractionPct = maizeIn > 0 ? Math.round((mealOut / maizeIn) * 1000) / 10 : null;
  const targetPct = Number(settings?.extractionTargetPct ?? 72);

  // The run that fell furthest short, named in the warning.
  const worst = batches
    .map((batch) => {
      const used = Number(batch.maizeIssuedKg);
      const made = batch.outputs.filter((row) => mealIds.has(row.productId)).reduce((sum, row) => sum + Number(row.quantityKg), 0);
      return { code: batch.code, pct: used > 0 ? Math.round((made / used) * 1000) / 10 : null };
    })
    .filter((row): row is { code: string; pct: number } => row.pct !== null)
    .sort((a, b) => a.pct - b.pct)[0];

  return {
    day: sites.day,
    figures: {
      maizeKg: sites.total.maizeKg,
      mealKg: sites.total.mealKg,
      extractionPct,
      downtimeHours: sites.total.downtimeHours,
      bagsOut: sites.total.bagsOut,
    },
    targetPct,
    shortfall: extractionPct !== null && extractionPct < targetPct ? { points: Math.round((targetPct - extractionPct) * 10) / 10, run: worst?.code ?? null, runPct: worst?.pct ?? null } : null,
    sites: sites.rows,
  };
}
