import { can } from "@/lib/milling/access/groups";
import { millRoute } from "@/lib/milling/api";
import { getGeneralSettings } from "@/lib/milling/settings/server";
import { openTripOf, tripTillSales } from "@/lib/milling/sales/sales";
import { prisma } from "@/lib/prisma";

/**
 * What the till needs to open: the packed products and their prices, the
 * stores holding released bags (office), the seller's own open trip with
 * what is left on it (road), the customers for a sale on account, and the
 * seller's discount rules.
 */
export const GET = millRoute(null, async ({ companyId, userId, access }) => {
  const mine = await openTripOf(prisma, companyId, userId);
  const office = can(access, "sale.record");
  const [products, stores, customers, settings, till, accounts] = await Promise.all([
    prisma.product.findMany({ where: { companyId, unit: "BAG", standardPrice: { gt: 0 } }, select: { id: true, name: true, standardPrice: true }, orderBy: { name: "asc" } }),
    office
      ? prisma.stockLocation.findMany({ where: { site: { companyId }, isActive: true, code: { not: "WITH-SELLERS" } }, select: { id: true, name: true, site: { select: { name: true } } }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] })
      : [],
    office ? prisma.customer.findMany({ where: { companyId }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }) : [],
    getGeneralSettings(prisma, companyId),
    mine ? tripTillSales(prisma, mine.trip.id) : null,
    office ? prisma.bankAccount.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true, currency: true }, orderBy: { name: "asc" } }) : [],
  ]);
  const balances = stores.length
    ? await prisma.millingLotBalance.findMany({
        where: { companyId, stockLocationId: { in: stores.map((row) => row.id) }, quantity: { gt: 0 }, lot: { status: "AVAILABLE", productId: { in: products.map((row) => row.id) } } },
        select: { stockLocationId: true, quantity: true, reserved: true, lot: { select: { productId: true } } },
      })
    : [];
  const free: Record<string, Record<string, number>> = {};
  for (const row of balances) {
    const left = Number(row.quantity) - Number(row.reserved);
    if (left <= 0) continue;
    const at = (free[row.stockLocationId] ??= {});
    at[row.lot.productId] = (at[row.lot.productId] ?? 0) + left;
  }
  return {
    office,
    products: products.map((row) => ({ id: row.id, name: row.name, price: Number(row.standardPrice) })),
    stores: stores.filter((row) => free[row.id]).map((row) => ({ id: row.id, name: `${row.name}, ${row.site.name}`, free: free[row.id] ?? {} })),
    customers,
    accounts,
    rules: { maxDiscount: Number(settings.sellerMaxDiscount), step: Number(settings.sellerDiscountStep) },
    trip: mine
      ? {
          id: mine.trip.id,
          code: mine.trip.code,
          seller: mine.seller.name,
          cash: till?.cash.toNumber() ?? 0,
          products: [...new Set(mine.trip.lines.map((line) => line.productId))].map((productId) => {
            const took = mine.trip.lines.filter((line) => line.productId === productId).reduce((sum, line) => sum + line.bagsOut, 0);
            return { id: productId, took, left: took - (till?.bags.get(productId) ?? 0), price: Number(mine.trip.lines.find((line) => line.productId === productId)!.unitPrice) };
          }),
        }
      : null,
  };
});
