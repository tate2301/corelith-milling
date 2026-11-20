import { millRoute, readBody } from "@/lib/milling/api";
import { routeBody } from "@/lib/milling/distribution/route-body";
import { listRoutes, saveRoute } from "@/lib/milling/distribution/trips";
import { prisma } from "@/lib/prisma";

/** Routes, with stops, days, usual vehicle and the last trip's kilometres; and the vehicles and customers a route can take. */
export const GET = millRoute(null, async ({ companyId }) => {
  const [routes, vehicles, customers, sellers] = await Promise.all([
    listRoutes(prisma, companyId),
    prisma.equipment.findMany({ where: { site: { companyId }, category: "VEHICLE", isActive: true }, select: { id: true, name: true, equipmentCode: true } }),
    prisma.customer.findMany({ where: { companyId, archivedAt: null }, select: { id: true, name: true, area: true, routeId: true }, orderBy: { name: "asc" }, take: 2000 }),
    prisma.millingSeller.findMany({ where: { companyId, customerId: { not: null } }, select: { customerId: true } }),
  ]);
  // A seller's Books account is not a shop on a route.
  const sellerAccounts = new Set(sellers.map((row) => row.customerId));
  return { routes, vehicles, customers: customers.filter((row) => !sellerAccounts.has(row.id)) };
});

export const POST = millRoute("delivery.manage", async ({ companyId }, request) => saveRoute(prisma, companyId, await readBody(request, routeBody)));
