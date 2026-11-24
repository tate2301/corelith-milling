import type { Prisma } from "@prisma/client";

/** Called in the Maintenance write transaction; preserve delivery capacity and driver on later edits. */
export async function linkMaintenanceVehicle(
  tx: Prisma.TransactionClient,
  input: { companyId: string; enabledFeatures?: readonly string[]; equipment: { id: string; category: string; registrationNumber: string | null } },
) {
  if (!input.enabledFeatures?.includes("milling.home") || input.equipment.category !== "VEHICLE") return;
  // Recheck the owning site rather than trusting caller-supplied equipment/company ids.
  const vehicle = await tx.equipment.findFirst({
    where: { id: input.equipment.id, site: { companyId: input.companyId }, category: "VEHICLE" },
    select: { id: true },
  });
  if (!vehicle) return;
  await tx.millingVehicleProfile.upsert({
    where: { equipmentId: vehicle.id },
    create: { companyId: input.companyId, equipmentId: vehicle.id, registrationNumber: input.equipment.registrationNumber },
    update: {},
  });
}
