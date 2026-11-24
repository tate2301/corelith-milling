import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { millAccessFor } from "../access/groups";
import { makeMill, removeMill } from "../testing/fixture";
import { waitingFor, yesterdayBySite } from "./home";

let mill: Awaited<ReturnType<typeof makeMill>>;

beforeAll(async () => {
  mill = await makeMill("home");
  await prisma.millingException.create({
    data: { companyId: mill.companyId, code: "EX-261120-01", type: "STOCK_DISCREPANCY", title: "Count short at Bin 1", targetType: "MillingStockCount", targetId: mill.companyId, severity: "HIGH", blocking: true, allowedDecisions: ["ACCEPT"], raisedById: mill.userId },
  });
});
afterAll(async () => {
  await removeMill(mill.companyId);
});

describe("the Overview", () => {
  it("shows each person only what their groups decide", async () => {
    const manager = await waitingFor(prisma, mill.companyId, millAccessFor("CLERK", ["MANAGEMENT"]));
    expect(manager.map((row) => [row.code, row.what, row.sentBy])).toEqual([["EX-261120-01", "Count short at Bin 1", "Tendai"]]);
    expect(await waitingFor(prisma, mill.companyId, millAccessFor("CLERK", ["DRIVER"]))).toEqual([]);
  });

  it("lists every site for yesterday, the mill's own figures on the mill's row", async () => {
    const day = await yesterdayBySite(prisma, mill.companyId, new Date("2026-11-20T08:00:00Z"));
    expect(day.day).toBe("2026-11-19");
    expect(day.rows.length).toBeGreaterThanOrEqual(1);
    expect(day.rows.some((row) => row.maizeKg !== null)).toBe(true);
    expect(day.total).toEqual({ maizeKg: 0, mealKg: 0, downtimeHours: 0, bagsOut: 0 });
  });
});
