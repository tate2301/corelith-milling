import { can } from "@/lib/milling/access/groups";
import { millRoute } from "@/lib/milling/api";
import { currentOpening, openingView } from "@/lib/milling/setup/go-live";
import { prisma } from "@/lib/prisma";

/** The opening stock (GL-B1): its counts, value and the journal it will post; made the first time stores opens it. */
export const GET = millRoute(null, async ({ companyId, userId, access }) => {
  const opening = await currentOpening(prisma, { companyId, userId, create: can(access, "stock.count") });
  if (!opening) return { opening: null };
  const [view, places, products] = await Promise.all([
    openingView(prisma, { companyId, userId, openingId: opening.id }),
    prisma.stockLocation.findMany({ where: { site: { companyId }, isActive: true, code: { not: "WITH-SELLERS" } }, select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.product.findMany({ where: { companyId, kind: { in: ["GOODS", "MATERIAL"] } }, select: { id: true, name: true, unit: true, costPrice: true }, orderBy: { name: "asc" } }),
  ]);
  return { opening: view, places, products: products.map((row) => ({ ...row, costPrice: Number(row.costPrice ?? 0) })) };
});
