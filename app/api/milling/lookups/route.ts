import { millRoute } from "@/lib/milling/api";
import { millSite } from "@/lib/milling/stock/views";
import { prisma } from "@/lib/prisma";

/** What the mill's forms choose from: products, locations with their kind, suppliers, and the checks in use. */
export const GET = millRoute(null, async ({ companyId }) => {
  const site = await millSite(prisma, companyId);
  const [products, locations, profiles, vendors, specs, settings, customers, destinations, vehicles, vehicleProfiles] = await Promise.all([
    prisma.product.findMany({ where: { companyId, kind: { in: ["GOODS", "MATERIAL"] } }, select: { id: true, code: true, name: true, unit: true, unitLabel: true, category: true, netWeightKg: true }, orderBy: { name: "asc" } }),
    site ? prisma.stockLocation.findMany({ where: { siteId: site.id, isActive: true }, select: { id: true, code: true, name: true }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }) : [],
    prisma.millingLocationProfile.findMany({ where: { companyId }, select: { stockLocationId: true, kind: true, capacityKg: true } }),
    prisma.vendor.findMany({ where: { companyId }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }),
    prisma.millingQcSpec.findMany({ where: { companyId, isActive: true }, orderBy: [{ point: "asc" }, { code: "asc" }] }),
    prisma.millingSettings.findUnique({ where: { companyId } }),
    prisma.customer.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 1000 }),
    prisma.millingDestination.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    site ? prisma.equipment.findMany({ where: { siteId: site.id, category: "VEHICLE", isActive: true }, select: { id: true, equipmentCode: true, name: true } }) : [],
    prisma.millingVehicleProfile.findMany({ where: { companyId } }),
  ]);
  return {
    site,
    products: products.map((product) => ({ ...product, netWeightKg: product.netWeightKg === null ? null : Number(product.netWeightKg) })),
    locations: locations.map((location) => {
      const profile = profiles.find((row) => row.stockLocationId === location.id);
      return { ...location, kind: profile?.kind ?? "STORE", capacityKg: profile?.capacityKg === null || profile?.capacityKg === undefined ? null : Number(profile.capacityKg) };
    }),
    vendors,
    specs: specs.map((spec) => ({ ...spec, minValue: spec.minValue === null ? null : Number(spec.minValue), maxValue: spec.maxValue === null ? null : Number(spec.maxValue) })),
    defaultIntakeBagKg: Number(settings?.defaultIntakeBagKg ?? 50),
    customers,
    destinations,
    vehicles: vehicles.map((vehicle) => {
      const profile = vehicleProfiles.find((row) => row.equipmentId === vehicle.id);
      return { ...vehicle, registrationNumber: profile?.registrationNumber ?? null, capacityKg: profile?.capacityKg ? Number(profile.capacityKg) : null, driverUserId: profile?.driverUserId ?? null };
    }),
  };
});
