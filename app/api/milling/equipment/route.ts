import { millRoute } from "@/lib/milling/api";
import { followWorkshop } from "@/lib/milling/maintenance/equipment";
import { millSite } from "@/lib/milling/stock/views";
import { prisma } from "@/lib/prisma";

/** The availability board: every machine at the mill, its state, and any open stop. */
export const GET = millRoute(null, async ({ companyId }) => {
  const site = await millSite(prisma, companyId);
  if (!site) return [];
  await followWorkshop(prisma, companyId);
  const [equipment, states, open] = await Promise.all([
    prisma.equipment.findMany({ where: { siteId: site.id, isActive: true }, select: { id: true, equipmentCode: true, name: true, category: true }, orderBy: { equipmentCode: "asc" } }),
    prisma.millingEquipmentState.findMany({ where: { companyId } }),
    prisma.millingDowntime.findMany({ where: { companyId, endedAt: null } }),
  ]);
  return equipment.map((row) => ({
    ...row,
    availability: states.find((state) => state.equipmentId === row.id)?.availability ?? "AVAILABLE",
    openStop: open.find((stop) => stop.equipmentId === row.id) ?? null,
  }));
});
