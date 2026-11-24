import { prisma } from "@/lib/prisma";

import { seedMill } from "../setup/seed";

/** A seeded mill in its own workspace, for DB tests, and a way to remove every trace of it. */
export async function makeMill(label: string) {
  const run = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const company = await prisma.company.create({ data: { name: `Mill ${run}`, slug: run, tenantStatus: "ACTIVE" } });
  const user = await prisma.user.create({ data: { name: "Tendai", email: `${run}@x.test`, role: "SUPERADMIN", companyId: company.id } });
  const seeded = await seedMill(prisma, company.id);
  const locations = await prisma.stockLocation.findMany({ where: { siteId: seeded.site.id } });
  const products = await prisma.product.findMany({ where: { companyId: company.id } });
  const location = (code: string) => locations.find((row) => row.code === code)!.id;
  const product = (code: string) => products.find((row) => row.code === code)!.id;
  return { companyId: company.id, userId: user.id, siteId: seeded.site.id, location, product };
}

export async function removeMill(companyId: string) {
  const where = { companyId };
  const siteIds = (await prisma.site.findMany({ where, select: { id: true } })).map((site) => site.id);
  const tables = [
    "millingSale",
    "millingSellerPayment",
    "millingSellerTrip",
    "millingSellerRate",
    "millingSeller",
    "millingDelivery",
    "millingCustomerOrder",
    "millingGeneratorRun",
    "millingDowntime",
    "millingEquipmentState",
    "millingPackRun",
    "millingBatch",
    "millingShift",
    "millingProductionOrder",
    "millingQcInspection",
    "millingStockCount",
    "millingIntake",
    "millingException",
    "millingReservation",
    "millingLot",
    "millingAmendment",
    "millingGroupMember",
    "millingPackRecipe",
    "millingVehicleProfile",
    "millingShiftDuty",
    "millingDestination",
    "millingQcSpec",
    "millingProcessStage",
    "millingLocationProfile",
    "millingSettings",
  ] as const;
  for (const table of tables) {
    await (prisma[table] as unknown as { deleteMany: (args: unknown) => Promise<unknown> }).deleteMany({ where });
  }
  const items = await prisma.inventoryItem.findMany({ where: { siteId: { in: siteIds } }, select: { id: true } });
  await prisma.stockMovement.deleteMany({ where: { itemId: { in: items.map((item) => item.id) } } });
  await prisma.inventoryItem.deleteMany({ where: { siteId: { in: siteIds } } });
  await prisma.attendance.deleteMany({ where });
  await prisma.customer.deleteMany({ where }).catch(() => undefined);
  await prisma.workOrder.deleteMany({ where });
  await prisma.employee.deleteMany({ where });
  await prisma.equipment.deleteMany({ where: { siteId: { in: siteIds } } });
  await prisma.stockLocation.deleteMany({ where: { siteId: { in: siteIds } } });
  await prisma.site.deleteMany({ where });
  await prisma.product.deleteMany({ where });
  await prisma.platformAuditEvent.deleteMany({ where });
  await prisma.idSequence.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.company.delete({ where: { id: companyId } });
}

/** An employee on the mill's books, for crews. */
export async function makeEmployee(companyId: string, name: string) {
  return prisma.employee.create({
    data: {
      companyId,
      employeeId: `E-${Math.random().toString(36).slice(2, 8)}`,
      name,
      phone: "+263770000000",
      nextOfKinName: "Kin",
      nextOfKinPhone: "+263770000001",
      passportPhotoUrl: "",
      villageOfOrigin: "Norton",
    },
  });
}
