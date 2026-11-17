import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { MeterRefusal, recordMeterReading } from "./meters";

let companyId: string;
let siteId: string;
let locationId: string;
const stamp = `meters-${Date.now()}`;

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: stamp, slug: stamp } })).id;
  siteId = (await prisma.site.create({ data: { companyId, name: "Norton", code: stamp } })).id;
  locationId = (await prisma.stockLocation.create({ data: { siteId, name: "Yard", code: stamp } })).id;
});

afterAll(async () => {
  if (!companyId) return;
  await prisma.equipment.deleteMany({ where: { siteId } });
  await prisma.stockLocation.deleteMany({ where: { siteId } });
  await prisma.site.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
});

let n = 0;
async function truck(meterType: "KM" | "NONE") {
  n += 1;
  return prisma.equipment.create({
    data: { siteId, locationId, equipmentCode: `${stamp}-${n}`, name: "UD truck", category: "VEHICLE", meterType, registrationNumber: "AEX 1234" },
  });
}

describe("meter readings", () => {
  it("moves the current reading on, and keeps an earlier one without moving it back", async () => {
    const t = await truck("KM");
    await recordMeterReading({ companyId, equipmentId: t.id, reading: 1000, readAt: new Date("2026-11-10T08:00:00Z") });
    await recordMeterReading({ companyId, equipmentId: t.id, reading: 1250.25, readAt: new Date("2026-11-12T08:00:00Z") });
    await recordMeterReading({ companyId, equipmentId: t.id, reading: 1100, readAt: new Date("2026-11-11T08:00:00Z") });
    const after = await prisma.equipment.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.currentMeter?.toFixed(1)).toBe("1250.3");
    expect(await prisma.meterReading.count({ where: { equipmentId: t.id } })).toBe(3);
  });

  it("refuses a reading that goes back, equipment without a meter, and another company's", async () => {
    const t = await truck("KM");
    await recordMeterReading({ companyId, equipmentId: t.id, reading: 500 });
    await expect(recordMeterReading({ companyId, equipmentId: t.id, reading: 499 })).rejects.toThrow(/cannot go back to 499/);
    const plain = await truck("NONE");
    await expect(recordMeterReading({ companyId, equipmentId: plain.id, reading: 1 })).rejects.toThrow(MeterRefusal);
    await expect(recordMeterReading({ companyId: "someone-else", equipmentId: t.id, reading: 600 })).rejects.toThrow("Unknown equipment.");
  });
});
