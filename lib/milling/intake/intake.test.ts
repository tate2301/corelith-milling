import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { decideException } from "../exceptions/exceptions";
import { lotsAgainstCore } from "../stock/ledger";
import { makeMill, removeMill } from "../testing/fixture";
import { confirmIntakeWeight, decideIntake, inspectIntake, recordIntake, weighIntake } from "./intake";

let mill: Awaited<ReturnType<typeof makeMill>>;

beforeAll(async () => {
  mill = await makeMill("intake");
});
afterAll(async () => {
  await removeMill(mill.companyId);
});

async function specs() {
  const rows = await prisma.millingQcSpec.findMany({ where: { companyId: mill.companyId, point: "INCOMING_MAIZE" } });
  return Object.fromEntries(rows.map((row) => [row.code, row.id]));
}

async function passingResults(moisture = 12) {
  const ids = await specs();
  return [
    { specId: ids.MOISTURE, method: "INSTRUMENT" as const, value: moisture },
    { specId: ids.VARIETY, method: "VISUAL" as const, passed: true },
    { specId: ids.INSECTS, method: "VISUAL" as const, passed: true },
    { specId: ids.FOREIGN, method: "VISUAL" as const, passed: true },
  ];
}

const delivery = (bags: number) => ({
  productId: mill.product("MAIZE"),
  supplierName: "Chirau farm",
  weighMethod: "BAG_COUNT" as const,
  bags,
});

describe("weighing", () => {
  it("works out net weight by method, and only a ticket is verified", () => {
    expect(weighIntake({ weighMethod: "BAG_COUNT", bags: 600 }, 50)).toEqual({ bags: 600, bagKg: 50, netKg: 30000, weightStatus: "PROVISIONAL" });
    expect(weighIntake({ weighMethod: "EXTERNAL_TICKET", ticketNumber: "T1", grossKg: 42000, tareKg: 12000 }, 50)).toMatchObject({ netKg: 30000, weightStatus: "VERIFIED" });
    expect(() => weighIntake({ weighMethod: "EXTERNAL_TICKET", ticketNumber: "T1", grossKg: 1000, tareKg: 2000 }, 50)).toThrow("Tare");
    expect(() => weighIntake({ weighMethod: "EXTERNAL_TICKET", netKg: 100 }, 50)).toThrow("ticket number");
  });
});

describe("maize intake", () => {
  it("accepts a delivery that passes QC into an available lot, and keeps core's total in step", async () => {
    const intake = await recordIntake(prisma, { companyId: mill.companyId, userId: mill.userId, input: delivery(600) });
    expect(intake.code).toMatch(/^MI-\d{6}-01$/);
    await expect(
      decideIntake(prisma, { companyId: mill.companyId, userId: mill.userId, intakeId: intake.id, decision: "ACCEPT", binLocationId: mill.location("MZ-STORE") }),
    ).rejects.toThrow("Inspect it first");

    await inspectIntake(prisma, { companyId: mill.companyId, userId: mill.userId, intakeId: intake.id, results: await passingResults() });
    const accepted = await decideIntake(prisma, {
      companyId: mill.companyId,
      userId: mill.userId,
      intakeId: intake.id,
      decision: "ACCEPT",
      binLocationId: mill.location("MZ-STORE"),
    });
    expect(accepted.status).toBe("ACCEPTED");
    const lot = await prisma.millingLot.findUniqueOrThrow({ where: { id: accepted.lotId! }, include: { balances: true } });
    expect(lot.status).toBe("AVAILABLE");
    expect(Number(lot.balances[0].quantity)).toBe(30000);

    const check = await lotsAgainstCore(prisma, mill.companyId, mill.siteId);
    const maize = check.find((row) => row.productId === mill.product("MAIZE"))!;
    expect(Number(maize.onHand)).toBe(30000);
    expect(Number(maize.notInALot)).toBe(0);
  });

  it("holds wet maize until management releases it, never on a bare accept", async () => {
    const intake = await recordIntake(prisma, { companyId: mill.companyId, userId: mill.userId, input: delivery(100) });
    await inspectIntake(prisma, { companyId: mill.companyId, userId: mill.userId, intakeId: intake.id, results: await passingResults(14.2) });
    const held = await decideIntake(prisma, {
      companyId: mill.companyId,
      userId: mill.userId,
      intakeId: intake.id,
      decision: "HOLD",
      binLocationId: mill.location("RCV"),
    });
    expect(held.status).toBe("HELD");
    expect((await prisma.millingLot.findUniqueOrThrow({ where: { id: held.lotId! } })).status).toBe("HOLD");

    await expect(
      decideIntake(prisma, { companyId: mill.companyId, userId: mill.userId, intakeId: intake.id, decision: "ACCEPT" }),
    ).rejects.toThrow("Waiting on a decision");

    const exception = await prisma.millingException.findFirstOrThrow({ where: { companyId: mill.companyId, targetId: intake.id, status: "OPEN" } });
    expect(exception.type).toBe("QC_FAIL");
    await prisma.$transaction((tx) =>
      decideException(tx, { companyId: mill.companyId, deciderId: mill.userId, exceptionId: exception.id, decision: "RELEASE_ANYWAY", note: "Blend with dry maize" }),
    );
    const accepted = await decideIntake(prisma, { companyId: mill.companyId, userId: mill.userId, intakeId: intake.id, decision: "ACCEPT" });
    expect(accepted.status).toBe("ACCEPTED");
    expect((await prisma.millingLot.findUniqueOrThrow({ where: { id: accepted.lotId! } })).status).toBe("AVAILABLE");
  });

  it("treats a required check not performed as never a pass", async () => {
    const intake = await recordIntake(prisma, { companyId: mill.companyId, userId: mill.userId, input: delivery(10) });
    const results = (await passingResults()).map((result) =>
      result.method === "INSTRUMENT" ? { ...result, method: "NOT_PERFORMED" as const, value: null } : result,
    );
    const inspection = await inspectIntake(prisma, { companyId: mill.companyId, userId: mill.userId, intakeId: intake.id, results });
    expect(inspection.outcome).toBe("INCOMPLETE");
    expect(await prisma.millingException.count({ where: { targetId: intake.id, type: "QC_NOT_PERFORMED" } })).toBe(1);
  });

  it("returns a held lot to the supplier on rejection", async () => {
    const intake = await recordIntake(prisma, { companyId: mill.companyId, userId: mill.userId, input: delivery(20) });
    const held = await decideIntake(prisma, { companyId: mill.companyId, userId: mill.userId, intakeId: intake.id, decision: "HOLD", binLocationId: mill.location("RCV") });
    const rejected = await decideIntake(prisma, { companyId: mill.companyId, userId: mill.userId, intakeId: intake.id, decision: "REJECT", note: "Weevils" });
    expect(rejected.status).toBe("REJECTED");
    const lot = await prisma.millingLot.findUniqueOrThrow({ where: { id: held.lotId! }, include: { balances: true } });
    expect(lot.status).toBe("REJECTED");
    expect(Number(lot.balances[0].quantity)).toBe(0);
  });

  it("confirms a provisional weight with a ticket, keeping the first figure", async () => {
    const intake = await recordIntake(prisma, { companyId: mill.companyId, userId: mill.userId, input: delivery(200) });
    await inspectIntake(prisma, { companyId: mill.companyId, userId: mill.userId, intakeId: intake.id, results: await passingResults() });
    const accepted = await decideIntake(prisma, { companyId: mill.companyId, userId: mill.userId, intakeId: intake.id, decision: "ACCEPT", binLocationId: mill.location("MZ-STORE") });
    const confirmed = await confirmIntakeWeight(prisma, {
      companyId: mill.companyId,
      userId: mill.userId,
      intakeId: intake.id,
      ticketNumber: "NB-4471",
      grossKg: 21850,
      tareKg: 12000,
      reason: "Ticket from Norton weighbridge",
    });
    expect(confirmed.weightStatus).toBe("VERIFIED");
    expect(Number(confirmed.netKg)).toBe(9850);
    const balance = await prisma.millingLotBalance.findFirstOrThrow({ where: { lotId: accepted.lotId! } });
    expect(Number(balance.quantity)).toBe(9850);
    const amendment = await prisma.millingAmendment.findFirstOrThrow({ where: { entityId: intake.id, field: "netKg" } });
    expect([amendment.oldValue, amendment.newValue]).toEqual([10000, 9850]);
  });
});
