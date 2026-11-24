/**
 * A mill's delivery details for Maintenance's vehicles live in its own
 * side-table, made the first time someone saves them (RELEASES_AND_FORKS.md,
 * "A fork's own data about core records"). Core's equipment routes never call
 * the mill; every vehicle still shows, and the details follow later edits.
 */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { makeMill, removeMill } from "@/lib/milling/testing/fixture";
import { listSettings, updateSetting } from "@/lib/milling/settings/server";

const auth = vi.hoisted(() => ({ companyId: "", userId: "" }));
vi.mock("@/lib/api-utils", async () => ({
  ...await import("@/lib/api-response"),
  validateSession: async () => ({ session: { user: { id: auth.userId, companyId: auth.companyId, role: "SUPERADMIN", workspaceProfile: "GENERAL", enabledFeatures: ["milling.home"] } } }),
}));
import { POST } from "@/app/api/equipment/route";
import { PATCH } from "@/app/api/equipment/[id]/route";

let mill: Awaited<ReturnType<typeof makeMill>>;
let other: Awaited<ReturnType<typeof makeMill>>;
beforeAll(async () => {
  mill = await makeMill("maintenance-vehicle"); other = await makeMill("maintenance-other");
  auth.companyId = mill.companyId; auth.userId = mill.userId;
});
afterAll(async () => { if (mill) await removeMill(mill.companyId); if (other) await removeMill(other.companyId); });
const request = (body: unknown, method = "POST") => new NextRequest("http://localhost/api/equipment", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const vehicleRow = async (equipmentId: string) => {
  const profile = await prisma.millingVehicleProfile.findUnique({ where: { equipmentId } });
  return (await listSettings(prisma, mill.companyId, "vehicles")).rows.find((row) => row.id === (profile?.id ?? equipmentId));
};

describe("Maintenance vehicles at the mill", () => {
  it("shows a new truck with Maintenance's plate before the mill has saved anything", async () => {
    const response = await POST(request({ equipmentCode: "EQP-9001", name: "Delivery truck", category: "VEHICLE", siteId: mill.siteId, locationId: mill.location("YARD"), registrationNumber: "ABC 1234" }));
    expect(response.status).toBe(201);
    const equipment = await response.json();
    expect(await prisma.millingVehicleProfile.findUnique({ where: { equipmentId: equipment.id } })).toBeNull();
    expect(await vehicleRow(equipment.id)).toMatchObject({ vehicle: expect.stringContaining("Delivery truck"), registrationNumber: "ABC 1234", capacityKg: null, driverUserId: null });
  });

  it("makes the profile on the first save and keeps it through Maintenance's edits", async () => {
    const equipment = await (await POST(request({ equipmentCode: "EQP-9002", name: "Second truck", category: "VEHICLE", siteId: mill.siteId, locationId: mill.location("YARD") }))).json();
    await updateSetting(prisma, { companyId: mill.companyId, actorId: mill.userId, key: "vehicles", id: equipment.id, body: { capacityKg: 8000, driverUserId: mill.userId } });
    expect(await prisma.millingVehicleProfile.count({ where: { equipmentId: equipment.id } })).toBe(1);
    expect((await PATCH(request({ name: "Renamed truck" }, "PATCH"), { params: Promise.resolve({ id: equipment.id }) })).status).toBe(200);
    expect(await vehicleRow(equipment.id)).toMatchObject({ vehicle: expect.stringContaining("Renamed truck"), capacityKg: 8000, driverUserId: mill.userId });
  });

  it("lists equipment once it becomes a vehicle, and drops it when retired", async () => {
    const equipment = await (await POST(request({ equipmentCode: "EQP-9003", name: "Utility", category: "OTHER", siteId: mill.siteId, locationId: mill.location("YARD") }))).json();
    expect(await vehicleRow(equipment.id)).toBeUndefined();
    await PATCH(request({ category: "VEHICLE" }, "PATCH"), { params: Promise.resolve({ id: equipment.id }) });
    expect(await vehicleRow(equipment.id)).toBeDefined();
    await PATCH(request({ isActive: false }, "PATCH"), { params: Promise.resolve({ id: equipment.id }) });
    expect(await vehicleRow(equipment.id)).toBeUndefined();
  });

  it("refuses another workspace's vehicle", async () => {
    const vehicle = await prisma.equipment.findFirstOrThrow({ where: { siteId: other.siteId, category: "VEHICLE" } });
    expect((await PATCH(request({ name: "Stolen" }, "PATCH"), { params: Promise.resolve({ id: vehicle.id }) })).status).toBe(403);
    await expect(updateSetting(prisma, { companyId: mill.companyId, actorId: mill.userId, key: "vehicles", id: vehicle.id, body: { capacityKg: 3 } })).rejects.toThrow("Not found");
    expect((await listSettings(prisma, mill.companyId, "vehicles")).rows.some((row) => row.id === vehicle.id)).toBe(false);
  });
});
