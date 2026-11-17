import type { PrismaClient } from "@prisma/client";

import { lotsAgainstCore } from "./ledger";

/** The mill's site: the one the seed made, else the company's first. */
export async function millSite(db: PrismaClient, companyId: string) {
  return (
    (await db.site.findFirst({ where: { companyId, code: "NORTON" }, select: { id: true, name: true } })) ??
    db.site.findFirst({ where: { companyId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } })
  );
}

/**
 * Stock on hand at the mill, product by product, each with its lots and where
 * they are, plus anything core holds that is in no lot (DECISIONS.md, D7).
 */
export async function stockOnHand(db: PrismaClient, companyId: string) {
  const site = await millSite(db, companyId);
  if (!site) return { products: [] };
  const [products, lots, locations, check] = await Promise.all([
    db.product.findMany({ where: { companyId, kind: { in: ["GOODS", "MATERIAL"] } }, select: { id: true, code: true, name: true, unit: true, unitLabel: true, category: true, netWeightKg: true }, orderBy: { name: "asc" } }),
    db.millingLot.findMany({ where: { companyId, status: { not: "CONSUMED" } }, include: { balances: { where: { quantity: { gt: 0 } } } }, orderBy: { producedAt: "asc" } }),
    db.stockLocation.findMany({ where: { siteId: site.id }, select: { id: true, code: true, name: true } }),
    lotsAgainstCore(db as never, companyId, site.id),
  ]);
  const locationOf = new Map(locations.map((location) => [location.id, location]));
  return {
    products: products
      .map((product) => {
        const own = lots.filter((lot) => lot.productId === product.id);
        const totals = check.find((row) => row.productId === product.id);
        const byStatus = (status: string) =>
          own.filter((lot) => lot.status === status).reduce((sum, lot) => sum + lot.balances.reduce((acc, row) => acc + Number(row.quantity), 0), 0);
        return {
          ...product,
          netWeightKg: product.netWeightKg === null ? null : Number(product.netWeightKg),
          onHand: Number(totals?.onHand ?? 0),
          available: byStatus("AVAILABLE"),
          onHold: byStatus("HOLD"),
          rejected: byStatus("REJECTED"),
          notInALot: Number(totals?.notInALot ?? 0),
          lots: own
            .filter((lot) => lot.balances.length)
            .map((lot) => ({
              id: lot.id,
              code: lot.code,
              status: lot.status,
              producedAt: lot.producedAt,
              attributes: lot.attributes,
              balances: lot.balances.map((row) => ({
                stockLocationId: row.stockLocationId,
                location: locationOf.get(row.stockLocationId)?.code ?? "?",
                quantity: Number(row.quantity),
                reserved: Number(row.reserved),
              })),
            })),
        };
      })
      .filter((product) => product.onHand !== 0 || product.lots.length > 0),
  };
}
