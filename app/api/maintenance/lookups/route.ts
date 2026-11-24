import { maintenanceRoute } from "@/lib/maintenance/api";
import { resolveVerticalDefaults } from "@/lib/platform/vertical-defaults";
import { prisma } from "@/lib/prisma";

/** What the maintenance sheets choose from: the machines and vehicles, the sites and their places, the categories, the technicians. */
export const GET = maintenanceRoute(async (session) => {
  const companyId = session.user.companyId;
  const [equipment, sites, technicians] = await Promise.all([
    prisma.equipment.findMany({
      where: { site: { companyId } },
      select: { id: true, equipmentCode: true, name: true, kind: true, category: true, meterType: true, currentMeter: true, isActive: true, siteId: true, locationId: true, registrationNumber: true, make: true, model: true, serialNumber: true, commissionedAt: true },
      orderBy: { equipmentCode: "asc" },
    }),
    prisma.site.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true, stockLocations: { where: { isActive: true }, select: { id: true, name: true } } }, orderBy: { name: "asc" } }),
    prisma.maintenanceTechnician.findMany({ where: { companyId, isActive: true }, include: { employee: { select: { id: true, name: true } } } }),
  ]);
  const user = session.user as { workspaceProfile?: string | null; enabledFeatures?: string[] };
  return {
    equipment: equipment.map((row) => ({ ...row, currentMeter: row.currentMeter === null ? null : Number(row.currentMeter) })),
    sites: sites.map((row) => ({ id: row.id, name: row.name, locations: row.stockLocations })),
    categories: resolveVerticalDefaults({ workspaceProfile: user.workspaceProfile, enabledFeatures: user.enabledFeatures }).maintenance.equipmentCategories,
    technicians: technicians.map((row) => ({ employeeId: row.employee.id, name: row.employee.name, trade: row.trade })),
  };
});
