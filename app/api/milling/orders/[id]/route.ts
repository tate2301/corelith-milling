import { millRefusal, millRoute } from "@/lib/milling/api";
import { requirementsFor } from "@/lib/milling/production/orders";
import { prisma } from "@/lib/prisma";

/** One order with what it needs against what is free, and its batches. */
export const GET = millRoute<{ id: string }>(null, async ({ companyId }, _request, { id }) => {
  const order = await prisma.millingProductionOrder.findFirst({ where: { id, companyId }, include: { lines: true } });
  if (!order) throw millRefusal("That production order is not in this workspace.");
  const [needs, batches, products, reservations] = await Promise.all([
    requirementsFor(prisma, companyId, order.lines),
    prisma.millingBatch.findMany({ where: { companyId, orderId: id }, orderBy: { startedAt: "asc" } }),
    prisma.product.findMany({ where: { companyId, id: { in: order.lines.map((line) => line.productId) } }, select: { id: true, name: true } }),
    prisma.millingReservation.findMany({ where: { companyId, sourceType: "MillingProductionOrder", sourceId: id } }),
  ]);
  return {
    order: { ...order, lines: order.lines.map((line) => ({ ...line, productName: products.find((product) => product.id === line.productId)?.name ?? "" })) },
    needs: {
      outputKg: Number(needs.outputKg),
      maizeKg: Number(needs.maizeKg),
      maizeAvailableKg: Number(needs.maizeAvailableKg),
      packaging: needs.packaging.map((row) => ({ ...row, needed: Number(row.needed), available: Number(row.available) })),
      short: needs.short,
    },
    reservedKg: reservations.filter((row) => row.status === "ACTIVE").reduce((sum, row) => sum + Number(row.quantity), 0),
    batches,
  };
});
