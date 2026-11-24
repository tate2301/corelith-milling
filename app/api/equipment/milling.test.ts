import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { makeMill, removeMill } from "@/lib/milling/testing/fixture";
import { linkMaintenanceVehicle } from "@/lib/milling/settings/vehicles";
import { listSettings, updateSetting } from "@/lib/milling/settings/server";

const auth = vi.hoisted(() => ({ companyId: "", userId: "", features: ["milling.home"] as string[] }));
vi.mock("@/lib/api-utils", async () => ({
  ...await import("@/lib/api-response"),
  validateSession: async () => ({ session: { user: { id: auth.userId, companyId: auth.companyId, role: "SUPERADMIN", workspaceProfile: "GENERAL", enabledFeatures: auth.features } } }),
}));
import { POST } from "./route";
import { PATCH } from "./[id]/route";

let mill: Awaited<ReturnType<typeof makeMill>>;
let other: Awaited<ReturnType<typeof makeMill>>;
beforeAll(async () => {
  mill = await makeMill("maintenance-vehicle"); other = await makeMill("maintenance-other");
  auth.companyId = mill.companyId; auth.userId = mill.userId;
});
afterAll(async () => { if (mill) await removeMill(mill.companyId); if (other) await removeMill(other.companyId); });
const request = (body: unknown, method = "POST") => new NextRequest("http://localhost/api/equipment", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("Maintenance vehicles at the mill", () => {
  it("does not create mill profiles for a non-milling session", async () => {
    const vehicle = await prisma.equipment.create({ data: { equipmentCode: "NON-MILL", name: "Non-mill session truck", category: "VEHICLE", siteId: mill.siteId, locationId: mill.location("YARD") } });
    await prisma.$transaction((tx) => linkMaintenanceVehicle(tx, { companyId: mill.companyId, enabledFeatures: [], equipment: vehicle }));
    expect(await prisma.millingVehicleProfile.findUnique({ where: { equipmentId: vehicle.id } })).toBeNull();
  });

  it("creates a delivery profile in the same write and preserves capacity and driver when edited", async () => {
    const response = await POST(request({ equipmentCode: "EQP-9001", name: "Delivery truck", category: "VEHICLE", siteId: mill.siteId, locationId: mill.location("YARD"), registrationNumber: "ABC 1234" }));
    expect(response.status).toBe(201);
    const equipment = await response.json();
    const profile = await prisma.millingVehicleProfile.findUniqueOrThrow({ where: { equipmentId: equipment.id } });
    expect(profile).toMatchObject({ companyId: mill.companyId, registrationNumber: "ABC 1234" });
    await updateSetting(prisma, { companyId: mill.companyId, actorId: mill.userId, key: "vehicles", id: profile.id, body: { capacityKg: 8000, driverUserId: mill.userId } });
    expect((await PATCH(request({ name: "Renamed truck" }, "PATCH"), { params: Promise.resolve({ id: equipment.id }) })).status).toBe(200);
    expect(await prisma.millingVehicleProfile.findUniqueOrThrow({ where: { equipmentId: equipment.id } })).toMatchObject({ driverUserId: mill.userId });
    expect((await prisma.millingVehicleProfile.findUniqueOrThrow({ where: { equipmentId: equipment.id } })).capacityKg?.toString()).toBe("8000");
    expect(await prisma.millingVehicleProfile.count({ where: { equipmentId: equipment.id } })).toBe(1);
    const rows = (await listSettings(prisma, mill.companyId, "vehicles")).rows;
    expect(rows.find((row) => row.id === profile.id)?.vehicle).toContain("Renamed truck");
  });

  it("links equipment changed into a vehicle, but does not link other categories", async () => {
    const response = await POST(request({ equipmentCode: "EQP-9002", name: "Utility", category: "OTHER", siteId: mill.siteId, locationId: mill.location("YARD") }));
    expect(response.status).toBe(201); const equipment = await response.json();
    expect(await prisma.millingVehicleProfile.findUnique({ where: { equipmentId: equipment.id } })).toBeNull();
    expect((await PATCH(request({ category: "VEHICLE" }, "PATCH"), { params: Promise.resolve({ id: equipment.id }) })).status).toBe(200);
    expect(await prisma.millingVehicleProfile.findUnique({ where: { equipmentId: equipment.id } })).not.toBeNull();
    await PATCH(request({ isActive: false }, "PATCH"), { params: Promise.resolve({ id: equipment.id }) });
    expect((await listSettings(prisma, mill.companyId, "vehicles")).rows.some((row) => String(row.vehicle).includes("Utility"))).toBe(false);
  });

  it("shows older Maintenance vehicles without a profile and saves their delivery details", async () => {
    const vehicle = await prisma.equipment.create({ data: { equipmentCode: "LEGACY", name: "Older truck", category: "VEHICLE", siteId: mill.siteId, locationId: mill.location("YARD") } });
    expect((await listSettings(prisma, mill.companyId, "vehicles")).rows.find((row) => row.id === vehicle.id)?.vehicle).toContain("Older truck");
    expect(await prisma.millingVehicleProfile.findUnique({ where: { equipmentId: vehicle.id } })).toBeNull();
    await updateSetting(prisma, { companyId: mill.companyId, actorId: mill.userId, key: "vehicles", id: vehicle.id, body: { capacityKg: 3000 } });
    expect(await prisma.millingVehicleProfile.findUnique({ where: { equipmentId: vehicle.id } })).not.toBeNull();
  });

  it("rejects cross-tenant equipment writes and profile edits", async () => {
    const vehicle = await prisma.equipment.findFirstOrThrow({ where: { siteId: other.siteId, category: "VEHICLE" } });
    expect((await PATCH(request({ name: "Stolen" }, "PATCH"), { params: Promise.resolve({ id: vehicle.id }) })).status).toBe(403);
    await expect(updateSetting(prisma, { companyId: mill.companyId, actorId: mill.userId, key: "vehicles", id: vehicle.id, body: { capacityKg: 3 } })).rejects.toThrow("Not found");
    expect((await listSettings(prisma, mill.companyId, "vehicles")).rows.some((row) => row.id === vehicle.id)).toBe(false);
  });
});
