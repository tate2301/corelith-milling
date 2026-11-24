import { millRoute } from "@/lib/milling/api";
import { prisma } from "@/lib/prisma";

/** Lots for QC: `?status=HOLD` (default), or one lot by `?id=`, with what each holds and its latest inspection. */
export const GET = millRoute(null, async ({ companyId }, request) => {
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const status = params.get("status") ?? "HOLD";
  const lots = await prisma.millingLot.findMany({
    where: { companyId, ...(id ? { id } : { status, originType: { in: ["BATCH", "RETURN", "INTAKE"] } }) },
    orderBy: { producedAt: "asc" },
    include: { balances: true },
    take: 200,
  });
  const [products, inspections, open] = await Promise.all([
    prisma.product.findMany({ where: { companyId, id: { in: lots.map((lot) => lot.productId) } }, select: { id: true, name: true } }),
    prisma.millingQcInspection.findMany({ where: { companyId, targetType: "MillingLot", targetId: { in: lots.map((lot) => lot.id) } }, orderBy: { inspectedAt: "desc" } }),
    prisma.millingException.findMany({ where: { companyId, targetType: "MillingLot", targetId: { in: lots.map((lot) => lot.id) }, status: "OPEN" } }),
  ]);
  return lots.map((lot) => ({
    id: lot.id,
    code: lot.code,
    status: lot.status,
    originType: lot.originType,
    producedAt: lot.producedAt,
    product: products.find((product) => product.id === lot.productId)?.name ?? "",
    quantity: lot.balances.reduce((sum, row) => sum + Number(row.quantity), 0),
    lastInspection: inspections.find((inspection) => inspection.targetId === lot.id) ?? null,
    waiting: open.filter((exception) => exception.targetId === lot.id).map((exception) => exception.code),
  }));
});
