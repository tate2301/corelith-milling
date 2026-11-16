import { millRefusal, millRoute } from "@/lib/milling/api";
import { INTAKE_ENTITY } from "@/lib/milling/intake/intake";
import { prisma } from "@/lib/prisma";

/** One delivery with its lot, inspections and exceptions. */
export const GET = millRoute<{ id: string }>(null, async ({ companyId }, _request, { id }) => {
  const intake = await prisma.millingIntake.findFirst({ where: { id, companyId } });
  if (!intake) throw millRefusal("That intake is not in this workspace.");
  const [inspections, exceptions, lot, product, bin] = await Promise.all([
    prisma.millingQcInspection.findMany({ where: { companyId, targetType: INTAKE_ENTITY, targetId: id }, orderBy: { inspectedAt: "desc" }, include: { results: true } }),
    prisma.millingException.findMany({ where: { companyId, targetType: INTAKE_ENTITY, targetId: id }, orderBy: { createdAt: "desc" } }),
    intake.lotId ? prisma.millingLot.findUnique({ where: { id: intake.lotId }, include: { balances: true } }) : null,
    prisma.product.findFirst({ where: { id: intake.productId, companyId }, select: { name: true } }),
    intake.binLocationId ? prisma.stockLocation.findFirst({ where: { id: intake.binLocationId }, select: { code: true, name: true } }) : null,
  ]);
  const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  return {
    intake: { ...intake, netKg: num(intake.netKg), grossKg: num(intake.grossKg), tareKg: num(intake.tareKg), bagKg: num(intake.bagKg) },
    productName: product?.name ?? null,
    bin,
    lot: lot ? { id: lot.id, code: lot.code, status: lot.status, onHand: lot.balances.reduce((sum, row) => sum + Number(row.quantity), 0) } : null,
    inspections: inspections.map((inspection) => ({ ...inspection, results: inspection.results.map((result) => ({ ...result, value: num(result.value) })) })),
    exceptions,
  };
});
