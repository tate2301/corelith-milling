import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { decideAndApply } from "../exceptions/decide";
import { makeMill, removeMill } from "../testing/fixture";
import { outsideTolerance, recordOpeningStock, submitCount } from "./counts";
import { createLot, issueFromLot, lotsAgainstCore, moveLot, receiveIntoLot, releaseReservation, reserve } from "./ledger";
import { Prisma } from "@prisma/client";

let mill: Awaited<ReturnType<typeof makeMill>>;
beforeAll(async () => {
  mill = await makeMill("stock");
});
afterAll(async () => {
  await removeMill(mill.companyId);
});

const source = () => ({ companyId: mill.companyId, userId: mill.userId, sourceType: "Test" });
const balance = async (lotId: string, code: string) =>
  Number((await prisma.millingLotBalance.findUnique({ where: { lotId_stockLocationId: { lotId, stockLocationId: mill.location(code) } } }))?.quantity ?? 0);

describe("the lot ledger", () => {
  it("refuses to use a lot on hold, and to take promised stock", async () => {
    const lotId = await prisma.$transaction(async (tx) => {
      const lot = await createLot(tx, { companyId: mill.companyId, code: "L-HOLD", productId: mill.product("MAIZE"), originType: "TEST" });
      await receiveIntoLot(tx, { ...source(), lotId: lot.id, stockLocationId: mill.location("MZ-STORE"), quantity: 1000, reason: "OPENING" });
      return lot.id;
    });
    await expect(
      prisma.$transaction((tx) => issueFromLot(tx, { ...source(), lotId, stockLocationId: mill.location("MZ-STORE"), quantity: 10, reason: "PRODUCTION_ISSUE" })),
    ).rejects.toThrow("cannot be used until QC releases it");

    await prisma.millingLot.update({ where: { id: lotId }, data: { status: "AVAILABLE" } });
    const reservation = await prisma.$transaction((tx) =>
      reserve(tx, { companyId: mill.companyId, userId: mill.userId, lotId, stockLocationId: mill.location("MZ-STORE"), quantity: 800, sourceType: "Order", sourceId: "o1" }),
    );
    await expect(
      prisma.$transaction((tx) => issueFromLot(tx, { ...source(), lotId, stockLocationId: mill.location("MZ-STORE"), quantity: 300, reason: "PRODUCTION_ISSUE" })),
    ).rejects.toThrow("Only 200");
    await prisma.$transaction((tx) =>
      issueFromLot(tx, { ...source(), lotId, stockLocationId: mill.location("MZ-STORE"), quantity: 800, reason: "PRODUCTION_ISSUE", reservationId: reservation.id }),
    );
    expect((await prisma.millingReservation.findUniqueOrThrow({ where: { id: reservation.id } })).status).toBe("FULFILLED");
    expect(await balance(lotId, "MZ-STORE")).toBe(200);
  });

  it("moves part of a lot between bins without touching core's total, and releases a promise", async () => {
    const lotId = await prisma.$transaction(async (tx) => {
      const lot = await createLot(tx, { companyId: mill.companyId, code: "L-MOVE", productId: mill.product("MAIZE"), status: "AVAILABLE", originType: "TEST" });
      await receiveIntoLot(tx, { ...source(), lotId: lot.id, stockLocationId: mill.location("MZ-STORE"), quantity: 500, reason: "OPENING" });
      return lot.id;
    });
    const coreBefore = (await lotsAgainstCore(prisma, mill.companyId, mill.siteId)).find((row) => row.productId === mill.product("MAIZE"))!.onHand;
    await prisma.$transaction((tx) => moveLot(tx, { ...source(), lotId, fromLocationId: mill.location("MZ-STORE"), toLocationId: mill.location("BIN-1"), quantity: 350 }));
    expect([await balance(lotId, "MZ-STORE"), await balance(lotId, "BIN-1")]).toEqual([150, 350]);
    const after = (await lotsAgainstCore(prisma, mill.companyId, mill.siteId)).find((row) => row.productId === mill.product("MAIZE"))!;
    expect(after.onHand.equals(coreBefore)).toBe(true);
    expect(Number(after.notInALot)).toBe(0);

    const promise = await prisma.$transaction((tx) =>
      reserve(tx, { companyId: mill.companyId, userId: mill.userId, lotId, stockLocationId: mill.location("BIN-1"), quantity: 100, sourceType: "Order", sourceId: "o2" }),
    );
    await prisma.$transaction((tx) => releaseReservation(tx, { companyId: mill.companyId, reservationId: promise.id }));
    const bin = await prisma.millingLotBalance.findFirstOrThrow({ where: { lotId, stockLocationId: mill.location("BIN-1") } });
    expect(Number(bin.reserved)).toBe(0);
  });

  it("marks a lot used up when nothing is left", async () => {
    const lotId = await prisma.$transaction(async (tx) => {
      const lot = await createLot(tx, { companyId: mill.companyId, code: "L-USE", productId: mill.product("MAIZE"), status: "AVAILABLE", originType: "TEST" });
      await receiveIntoLot(tx, { ...source(), lotId: lot.id, stockLocationId: mill.location("BIN-1"), quantity: 50, reason: "OPENING" });
      await issueFromLot(tx, { ...source(), lotId: lot.id, stockLocationId: mill.location("BIN-1"), quantity: 50, reason: "PRODUCTION_ISSUE" });
      return lot.id;
    });
    expect((await prisma.millingLot.findUniqueOrThrow({ where: { id: lotId } })).status).toBe("CONSUMED");
  });
});

describe("counts and opening stock", () => {
  it("judges tolerance on the expected figure", () => {
    const d = (value: number) => new Prisma.Decimal(value);
    expect(outsideTolerance(d(1000), d(985), 2)).toBe(false);
    expect(outsideTolerance(d(1000), d(970), 2)).toBe(true);
    expect(outsideTolerance(d(0), d(1), 2)).toBe(true);
  });

  it("posts a count within tolerance at once, and holds a larger one for management", async () => {
    const lot = await recordOpeningStock(prisma, { companyId: mill.companyId, userId: mill.userId, productId: mill.product("BAG-10"), stockLocationId: mill.location("PKG"), quantity: 2000 });
    expect(lot.code).toMatch(/^OPEN-BAG-10-/);

    const small = await submitCount(prisma, { companyId: mill.companyId, userId: mill.userId, stockLocationId: mill.location("PKG"), lines: [{ lotId: lot.id, counted: 1990 }] });
    expect(small.status).toBe("POSTED");
    expect(await balance(lot.id, "PKG")).toBe(1990);

    await expect(
      submitCount(prisma, { companyId: mill.companyId, userId: mill.userId, stockLocationId: mill.location("PKG"), lines: [] }),
    ).rejects.toThrow("Count every lot");

    const big = await submitCount(prisma, { companyId: mill.companyId, userId: mill.userId, stockLocationId: mill.location("PKG"), lines: [{ lotId: lot.id, counted: 1500 }] });
    expect(big.status).toBe("AWAITING_DECISION");
    expect(await balance(lot.id, "PKG")).toBe(1990);

    const exception = await prisma.millingException.findFirstOrThrow({ where: { targetId: big.id, status: "OPEN" } });
    await decideAndApply(prisma, { companyId: mill.companyId, deciderId: mill.userId, exceptionId: exception.id, decision: "POST_COUNT", note: "Bags found damaged and burnt" });
    expect((await prisma.millingStockCount.findUniqueOrThrow({ where: { id: big.id } })).status).toBe("POSTED");
    expect(await balance(lot.id, "PKG")).toBe(1500);

    const core = (await lotsAgainstCore(prisma, mill.companyId, mill.siteId)).find((row) => row.productId === mill.product("BAG-10"))!;
    expect(Number(core.onHand)).toBe(1500);
  });

  it("refuses a decision that the exception does not offer, or with no reason", async () => {
    const lot = await recordOpeningStock(prisma, { companyId: mill.companyId, userId: mill.userId, productId: mill.product("THREAD"), stockLocationId: mill.location("PKG"), quantity: 40 });
    const count = await submitCount(prisma, {
      companyId: mill.companyId,
      userId: mill.userId,
      stockLocationId: mill.location("PKG"),
      lines: [
        { lotId: lot.id, counted: 10 },
        ...(await prisma.millingLotBalance.findMany({ where: { stockLocationId: mill.location("PKG"), lotId: { not: lot.id }, quantity: { gt: 0 } } })).map((row) => ({
          lotId: row.lotId,
          counted: Number(row.quantity),
        })),
      ],
    });
    const exception = await prisma.millingException.findFirstOrThrow({ where: { targetId: count.id } });
    await expect(decideAndApply(prisma, { companyId: mill.companyId, deciderId: mill.userId, exceptionId: exception.id, decision: "RELEASE_ANYWAY", note: "x y z" })).rejects.toThrow("Choose one of");
    await expect(decideAndApply(prisma, { companyId: mill.companyId, deciderId: mill.userId, exceptionId: exception.id, decision: "DISCARD_COUNT", note: "" })).rejects.toThrow("Say why");
    await decideAndApply(prisma, { companyId: mill.companyId, deciderId: mill.userId, exceptionId: exception.id, decision: "DISCARD_COUNT", note: "Miscounted cones" });
    expect(await balance(lot.id, "PKG")).toBe(40);
  });
});
