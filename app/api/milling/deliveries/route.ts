import { z } from "zod";

import { can } from "@/lib/milling/access/groups";
import { millRoute, readBody } from "@/lib/milling/api";
import { planDelivery } from "@/lib/milling/distribution/deliveries";
import { prisma } from "@/lib/prisma";

/** Deliveries by status. A driver who does not manage deliveries sees only their own. */
export const GET = millRoute(null, async ({ companyId, userId, access }, request) => {
  const params = new URL(request.url).searchParams;
  const status = params.get("status");
  const onlyMine = params.get("mine") === "1" || !can(access, "delivery.manage");
  const where = { companyId, ...(onlyMine ? { driverId: userId } : {}) };
  const statusWhere = status === "ACTIVE" ? { status: { in: ["PLANNED", "LOADING"] } } : status ? { status } : {};
  const [rows, counts] = await Promise.all([
    prisma.millingDelivery.findMany({ where: { ...where, ...statusWhere }, orderBy: { createdAt: "desc" }, take: 200, include: { lines: { select: { bags: true, orderId: true } } } }),
    prisma.millingDelivery.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);
  const [vehicles, drivers, destinations] = await Promise.all([
    prisma.equipment.findMany({ where: { id: { in: rows.map((row) => row.vehicleId) } }, select: { id: true, equipmentCode: true, name: true } }),
    prisma.user.findMany({ where: { companyId, id: { in: rows.map((row) => row.driverId).filter((id): id is string => Boolean(id)) } }, select: { id: true, name: true } }),
    prisma.millingDestination.findMany({ where: { companyId } }),
  ]);
  return {
    counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
    rows: rows.map((row) => ({
      ...row,
      vehicle: vehicles.find((vehicle) => vehicle.id === row.vehicleId) ?? null,
      driver: drivers.find((driver) => driver.id === row.driverId)?.name ?? null,
      destination: destinations.find((destination) => destination.id === row.destinationId)?.name ?? null,
      bags: row.lines.reduce((sum, line) => sum + line.bags, 0),
      orders: new Set(row.lines.map((line) => line.orderId)).size,
      lines: undefined,
    })),
  };
});

const body = z.object({
  vehicleId: z.string().uuid("Choose the vehicle."),
  driverId: z.string().uuid().nullable().optional(),
  destinationId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const POST = millRoute("delivery.manage", async ({ companyId, userId }, request) => planDelivery(prisma, { companyId, userId, ...(await readBody(request, body)) }));
