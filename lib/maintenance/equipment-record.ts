import type { PrismaClient } from "@prisma/client";

/**
 * One machine or vehicle, for its record: what it is, where it is, its meter,
 * and its last 30 days in figures (time down, what its work cost, the fuel it
 * took and what that came to a kilometre or an hour).
 */

const DAY = 86_400_000;

export async function readEquipmentRecord(db: PrismaClient, companyId: string, id: string, now: Date = new Date()) {
  const row = await db.equipment.findFirst({
    where: { id, site: { companyId } },
    include: { site: { select: { name: true } }, location: { select: { name: true } } },
  });
  if (!row) return null;
  const since = new Date(now.getTime() - 30 * DAY);
  const [orders, fuel, readings, plans] = await Promise.all([
    db.workOrder.findMany({ where: { equipmentId: id, status: { not: "DRAFT" }, OR: [{ downtimeStart: { gte: since } }, { downtimeEnd: null }, { downtimeEnd: { gte: since } }] }, select: { kind: true, status: true, downtimeStart: true, downtimeEnd: true, partsCost: true, laborCost: true } }),
    db.stockMovement.findMany({ where: { equipmentId: id, movementType: "ISSUE", createdAt: { gte: since }, item: { category: "FUEL" } }, select: { quantity: true } }),
    db.meterReading.findMany({ where: { equipmentId: id, readAt: { gte: since } }, orderBy: { readAt: "asc" }, select: { reading: true } }),
    db.maintenancePlan.findMany({ where: { equipmentId: id, isActive: true }, orderBy: { nextDueAt: "asc" }, select: { id: true, name: true, nextDueAt: true, nextDueMeter: true } }),
  ]);
  const downHours = orders
    .filter((order) => order.kind === "BREAKDOWN")
    .reduce((sum, order) => sum + Math.max(0, (Math.min((order.downtimeEnd ?? now).getTime(), now.getTime()) - Math.max(order.downtimeStart.getTime(), since.getTime())) / 3_600_000), 0);
  const litres = fuel.reduce((sum, issue) => sum + Number(issue.quantity), 0);
  const moved = readings.length >= 2 ? Number(readings[readings.length - 1]!.reading) - Number(readings[0]!.reading) : 0;
  const down = orders.some((order) => order.kind === "BREAKDOWN" && (order.status === "OPEN" || order.status === "IN_PROGRESS"));
  return {
    id: row.id,
    code: row.equipmentCode,
    name: row.name,
    kind: row.kind,
    category: row.category,
    isActive: row.isActive,
    site: row.site.name,
    location: row.location.name,
    make: row.make,
    model: row.model,
    serialNumber: row.serialNumber,
    registrationNumber: row.registrationNumber,
    commissionedAt: row.commissionedAt?.toISOString() ?? null,
    meterType: row.meterType,
    currentMeter: row.currentMeter === null ? null : Number(row.currentMeter),
    meterReadAt: row.meterReadAt?.toISOString() ?? null,
    state: !row.isActive ? "RETIRED" : down ? "DOWN" : "WORKING",
    month: {
      downHours: Math.round(downHours * 10) / 10,
      cost: Math.round(orders.reduce((sum, order) => sum + (order.partsCost ?? 0) + (order.laborCost ?? 0), 0) * 100) / 100,
      litres: Math.round(litres * 10) / 10,
      moved,
      rate: moved > 0 && litres > 0 ? (row.meterType === "KM" ? Math.round((litres / moved) * 1000) / 10 : Math.round((litres / moved) * 10) / 10) : null,
    },
    nextService: plans[0] ? { id: plans[0].id, name: plans[0].name, at: plans[0].nextDueAt?.toISOString() ?? null, meter: plans[0].nextDueMeter === null ? null : Number(plans[0].nextDueMeter) } : null,
  };
}

export type EquipmentRecord = NonNullable<Awaited<ReturnType<typeof readEquipmentRecord>>>;
