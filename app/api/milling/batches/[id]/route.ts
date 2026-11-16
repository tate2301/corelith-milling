import { millRefusal, millRoute } from "@/lib/milling/api";
import { availabilityByCode } from "@/lib/milling/maintenance/equipment";
import { prisma } from "@/lib/prisma";

/** A batch: its maize, stage records against the route, outputs, balance and exceptions. */
export const GET = millRoute<{ id: string }>(null, async ({ companyId }, _request, { id }) => {
  const batch = await prisma.millingBatch.findFirst({ where: { id, companyId }, include: { sources: true, stages: { orderBy: { startedAt: "asc" } }, outputs: true } });
  if (!batch) throw millRefusal("That batch is not in this workspace.");
  const [route, lots, products, locations, exceptions, order, downtime, people] = await Promise.all([
    prisma.millingProcessStage.findMany({ where: { companyId, isActive: true }, orderBy: { sequence: "asc" } }),
    prisma.millingLot.findMany({ where: { id: { in: [...batch.sources.map((row) => row.lotId), ...batch.outputs.map((row) => row.lotId)] } }, select: { id: true, code: true, status: true, attributes: true } }),
    prisma.product.findMany({ where: { companyId, id: { in: batch.outputs.map((row) => row.productId) } }, select: { id: true, name: true, code: true } }),
    prisma.stockLocation.findMany({ where: { site: { companyId } }, select: { id: true, code: true } }),
    prisma.millingException.findMany({ where: { companyId, targetType: "MillingBatch", targetId: id }, orderBy: { createdAt: "desc" } }),
    batch.orderId ? prisma.millingProductionOrder.findFirst({ where: { id: batch.orderId }, select: { id: true, code: true } }) : null,
    prisma.millingDowntime.findMany({ where: { companyId, batchId: id }, orderBy: { startedAt: "asc" } }),
    prisma.user.findMany({ where: { companyId, id: { in: batch.stages.map((row) => row.operatorId) } }, select: { id: true, name: true } }),
  ]);
  const states = await availabilityByCode(prisma, companyId, [...new Set(route.flatMap((stage) => stage.equipmentCodes))]);
  const code = (locationId: string) => locations.find((location) => location.id === locationId)?.code ?? "?";
  return {
    batch,
    order,
    route: route.map((stage) => ({ ...stage, equipment: stage.equipmentCodes.map((equipmentCode) => ({ code: equipmentCode, availability: states.get(equipmentCode) ?? "UNKNOWN" })) })),
    stages: batch.stages.map((row) => ({ ...row, operator: people.find((person) => person.id === row.operatorId)?.name ?? null })),
    sources: batch.sources.map((row) => ({ ...row, lot: lots.find((lot) => lot.id === row.lotId), location: code(row.stockLocationId) })),
    outputs: batch.outputs.map((row) => ({ ...row, lot: lots.find((lot) => lot.id === row.lotId), product: products.find((product) => product.id === row.productId), location: code(row.stockLocationId) })),
    exceptions,
    downtime,
  };
});
