import { millRoute } from "@/lib/milling/api";
import { prisma } from "@/lib/prisma";

/** The mill's movements ledger, newest first: `?lotId=` for one lot. */
export const GET = millRoute(null, async ({ companyId }, request) => {
  const lotId = new URL(request.url).searchParams.get("lotId");
  const rows = await prisma.millingLotMovement.findMany({
    where: { companyId, ...(lotId ? { lotId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { lot: { select: { code: true, productId: true } } },
  });
  const [locations, products, people] = await Promise.all([
    prisma.stockLocation.findMany({ where: { site: { companyId } }, select: { id: true, code: true } }),
    prisma.product.findMany({ where: { companyId, id: { in: [...new Set(rows.map((row) => row.lot.productId))] } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { companyId, id: { in: [...new Set(rows.map((row) => row.createdById))] } }, select: { id: true, name: true } }),
  ]);
  const code = (id: string | null) => (id ? locations.find((location) => location.id === id)?.code ?? "?" : null);
  return rows.map((row) => ({
    id: row.id,
    at: row.createdAt,
    lot: row.lot.code,
    lotId: row.lotId,
    product: products.find((product) => product.id === row.lot.productId)?.name ?? "",
    from: code(row.fromLocationId),
    to: code(row.toLocationId),
    quantity: Number(row.quantity),
    reason: row.reason,
    isEstimated: row.isEstimated,
    by: people.find((person) => person.id === row.createdById)?.name ?? null,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
  }));
});
