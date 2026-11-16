import type { PrismaClient } from "@prisma/client";

import { matchCoreIssue } from "../stock/ledger";
import { millSite } from "../stock/views";

/**
 * Gate sales (plan v2, L4; DECISIONS.md D10). The mill's gate till is core's
 * retail till, fiscalised with ZIMRA, selling packed bags. A sale moves core's
 * stock; this matches each sale to the mill's lots, oldest first, so the lot
 * ledger and core agree again. Safe to run as often as wanted: a sale already
 * matched is skipped. Refunds and voids are left for a count to settle.
 */
export async function matchGateSales(db: PrismaClient, args: { companyId: string; userId: string; since?: Date }) {
  const site = await millSite(db, args.companyId);
  if (!site) return { matched: 0, unmatchedQuantity: 0 };
  const lotProducts = await db.millingLot.findMany({ where: { companyId: args.companyId }, select: { productId: true }, distinct: ["productId"] });
  const items = await db.inventoryItem.findMany({ where: { siteId: site.id, productId: { in: lotProducts.map((row) => row.productId) } }, select: { id: true, productId: true } });
  const sales = await db.stockMovement.findMany({
    where: { itemId: { in: items.map((item) => item.id) }, reason: "SALE", movementType: "ISSUE", ...(args.since ? { createdAt: { gte: args.since } } : {}) },
    orderBy: { createdAt: "asc" },
    select: { id: true, itemId: true, quantity: true, reference: true },
    take: 2000,
  });
  const done = new Set(
    (await db.millingLotMovement.findMany({ where: { companyId: args.companyId, stockMovementId: { in: sales.map((sale) => sale.id) } }, select: { stockMovementId: true } })).map((row) => row.stockMovementId),
  );
  let matched = 0;
  let unmatched = 0;
  for (const sale of sales) {
    if (done.has(sale.id)) continue;
    const productId = items.find((item) => item.id === sale.itemId)?.productId;
    if (!productId) continue;
    const left = await db.$transaction((tx) =>
      matchCoreIssue(tx, { companyId: args.companyId, userId: args.userId, productId, quantity: sale.quantity.abs(), stockMovementId: sale.id, reference: sale.reference }),
    );
    matched += 1;
    unmatched += left.toNumber();
  }
  return { matched, unmatchedQuantity: unmatched };
}
