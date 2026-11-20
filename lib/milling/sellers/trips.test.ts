import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { confirmCustomerOrder, createCustomerOrder } from "../distribution/customer-orders";
import { recordOpeningStock } from "../stock/counts";
import { lotsAgainstCore } from "../stock/ledger";
import { makeEmployee, makeMill, removeMill } from "../testing/fixture";
import {
  addSeller,
  cancelSellerTrip,
  issueSellerTrip,
  millDay,
  recordSellerPayment,
  retireSeller,
  sellerBalance,
  settlementFigures,
  settleSellerTrip,
} from "./trips";

let mill: Awaited<ReturnType<typeof makeMill>>;
let sellerId = "";
let sellerUserId = "";
const MEAL = () => mill.product("MEAL-10");
const MEAL5 = () => mill.product("MEAL-5");

beforeAll(async () => {
  mill = await makeMill("sellers");
  await prisma.product.update({ where: { id: MEAL() }, data: { standardPrice: 6 } });
  await prisma.product.update({ where: { id: MEAL5() }, data: { standardPrice: 3.5 } });
  await prisma.millingSellerRate.create({ data: { companyId: mill.companyId, productId: MEAL(), commissionPerBag: 0.25 } });
  await prisma.millingSellerRate.create({ data: { companyId: mill.companyId, productId: MEAL5(), commissionPct: 5 } });
  await recordOpeningStock(prisma, { companyId: mill.companyId, userId: mill.userId, productId: MEAL(), stockLocationId: mill.location("FG"), quantity: 40, lotCode: "S-OLD" });
  await recordOpeningStock(prisma, { companyId: mill.companyId, userId: mill.userId, productId: MEAL(), stockLocationId: mill.location("FG"), quantity: 60, lotCode: "S-NEW" });
  await recordOpeningStock(prisma, { companyId: mill.companyId, userId: mill.userId, productId: MEAL5(), stockLocationId: mill.location("FG"), quantity: 50, lotCode: "S-FIVE" });
  const employee = await makeEmployee(mill.companyId, "Rudo Moyo");
  const user = await prisma.user.create({ data: { name: "Rudo Moyo", email: `rudo-${Date.now()}@x.test`, role: "CLERK", companyId: mill.companyId } });
  await prisma.employee.update({ where: { id: employee.id }, data: { userId: user.id } });
  sellerUserId = user.id;
  sellerId = (await addSeller(prisma, { companyId: mill.companyId, userId: mill.userId, employeeId: employee.id })).id;
});
afterAll(async () => {
  await removeMill(mill.companyId);
});

const who = () => ({ companyId: mill.companyId, userId: mill.userId });
const DAY1 = new Date("2026-11-20T06:00:00Z");
const DAY2 = new Date("2026-11-21T06:00:00Z");
const DAY3 = new Date("2026-11-22T06:00:00Z");
const atStore = async (code: string) =>
  Number((await prisma.millingLotBalance.findFirst({ where: { lot: { companyId: mill.companyId, code }, stockLocationId: mill.location("FG") } }))?.quantity ?? 0);
const onHand = async (productId: string) => Number((await prisma.inventoryItem.findFirstOrThrow({ where: { siteId: mill.siteId, productId } })).currentStock);

describe("what a seller owes (pure)", () => {
  const lines = [
    { productId: "meal", bagsOut: 30, unitPrice: 6, commissionPerBag: 0.25, commissionPct: 0 },
    { productId: "five", bagsOut: 10, unitPrice: 3.5, commissionPerBag: 0, commissionPct: 5 },
  ];
  const rules = { maxDiscount: 1, step: 0.1 };

  it("owes full price for bags sold, less discounts, and earns commission on what was sold", () => {
    const figures = settlementFigures(lines, { returned: [{ productId: "meal", bags: 5 }, { productId: "five", bags: 10 }], discounts: [{ productId: "meal", discount: 0.5, bags: 4 }] }, rules);
    expect(figures.gross.toNumber()).toBe(150);
    expect(figures.discount.toNumber()).toBe(2);
    expect(figures.due.toNumber()).toBe(148);
    expect(figures.commission.toNumber()).toBe(6.25);
  });

  it("works the share on what the bags were sold for", () => {
    const figures = settlementFigures(lines, { returned: [{ productId: "meal", bags: 30 }], discounts: [{ productId: "five", discount: 1, bags: 10 }] }, rules);
    expect(figures.due.toNumber()).toBe(25);
    expect(figures.commission.toNumber()).toBe(1.25);
  });

  it("allows up to a dollar off a bag, in 10c steps, on bags that were sold", () => {
    const sold = { returned: [{ productId: "meal", bags: 28 }] };
    expect(() => settlementFigures(lines, { ...sold, discounts: [{ productId: "meal", discount: 1.1, bags: 1 }] }, rules)).toThrow("at most $1.00");
    expect(() => settlementFigures(lines, { ...sold, discounts: [{ productId: "meal", discount: 0.15, bags: 1 }] }, rules)).toThrow("steps of $0.10");
    expect(() => settlementFigures(lines, { ...sold, discounts: [{ productId: "meal", discount: 0.3, bags: 3 }] }, rules)).toThrow("more bags");
    expect(settlementFigures(lines, { ...sold, discounts: [{ productId: "meal", discount: 0.3, bags: 2 }] }, rules).discount.toNumber()).toBe(0.6);
  });

  it("refuses more bags back than went out", () => {
    expect(() => settlementFigures(lines, { returned: [{ productId: "meal", bags: 31 }], discounts: [] }, rules)).toThrow("More bags");
  });
});

describe("a seller's day", () => {
  let tripId = "";

  it("gives out the oldest bags and keeps them for the trip", async () => {
    const trip = await issueSellerTrip(prisma, {
      ...who(),
      sellerId,
      fromLocationId: mill.location("FG"),
      mayOverride: false,
      lines: [{ productId: MEAL(), bags: 50 }, { productId: MEAL5(), bags: 10 }],
      at: DAY1,
    });
    tripId = trip.id;
    expect(trip.code).toMatch(/^ST-261120-01$/);
    expect(trip.tripDate.toISOString().slice(0, 10)).toBe("2026-11-20");
    expect([await atStore("S-OLD"), await atStore("S-NEW"), await atStore("S-FIVE")]).toEqual([0, 50, 40]);
    // Still the mill's stock until sold.
    expect(await onHand(MEAL())).toBe(100);
    expect(trip.lines.map((line) => line.bagsOut).sort((a, b) => a - b)).toEqual([10, 10, 40]);

    // Nothing else can take bags that are out with a seller.
    const customer = await prisma.customer.create({ data: { companyId: mill.companyId, name: "Shop" } });
    const order = await createCustomerOrder(prisma, { ...who(), customerId: customer.id, lines: [{ productId: MEAL(), bags: 60 }] });
    await expect(confirmCustomerOrder(prisma, { ...who(), orderId: order.id })).rejects.toThrow("Only 50 bags");
  });

  it("allows one trip a day, and never your own", async () => {
    await expect(issueSellerTrip(prisma, { ...who(), sellerId, fromLocationId: mill.location("FG"), mayOverride: true, lines: [{ productId: MEAL(), bags: 1 }], at: DAY1 })).rejects.toThrow("still out");
    await expect(settleSellerTrip(prisma, { companyId: mill.companyId, userId: sellerUserId, tripId, returned: [], discounts: [], cashReceived: 0 })).rejects.toThrow("Someone else");
  });

  it("settles: bags back to the store, sold bags off stock, a shortage stays on the seller", async () => {
    // 50 meal out, 8 back: 42 sold at $6 = 252, 5 at 40c off = 2; 10 five-kg out, 4 back: 6 sold at 3.50 = 21. Due 271.
    const { trip, owed } = await settleSellerTrip(prisma, {
      ...who(),
      tripId,
      returned: [{ productId: MEAL(), bags: 8 }, { productId: MEAL5(), bags: 4 }],
      discounts: [{ productId: MEAL(), discount: 0.4, bags: 5 }],
      cashReceived: 261,
    });
    expect(trip.status).toBe("SETTLED");
    expect(Number(trip.amountDue)).toBe(271);
    expect(Number(trip.shortage)).toBe(10);
    // 42 x 0.25 + 5% of 21.
    expect(Number(trip.commissionAmount)).toBe(11.55);
    expect(owed.toNumber()).toBe(10);
    // The newest lot's bags came back; the oldest were sold.
    expect([await atStore("S-OLD"), await atStore("S-NEW"), await atStore("S-FIVE")]).toEqual([0, 58, 44]);
    expect(await onHand(MEAL())).toBe(58);
    expect(await onHand(MEAL5())).toBe(44);
    const reserved = await prisma.millingReservation.count({ where: { companyId: mill.companyId, sourceId: tripId, status: "ACTIVE" } });
    expect(reserved).toBe(0);
    for (const row of await lotsAgainstCore(prisma, mill.companyId, mill.siteId)) expect(row.notInALot.toNumber()).toBe(0);
  });

  it("keeps a seller who owes money in until it is paid, unless a manager overrides with a reason", async () => {
    const out = { ...who(), sellerId, fromLocationId: mill.location("FG"), lines: [{ productId: MEAL(), bags: 5 }], at: DAY2 };
    await expect(issueSellerTrip(prisma, { ...out, mayOverride: false })).rejects.toThrow("owes $10.00");
    await expect(issueSellerTrip(prisma, { ...out, mayOverride: true })).rejects.toThrow("Give a reason");
    const trip = await issueSellerTrip(prisma, { ...out, mayOverride: true, overrideReason: "Pays Friday" });
    expect(trip.overrideReason).toBe("Pays Friday");
    expect(Number(trip.owedAtIssue)).toBe(10);
    // Nothing sold: called off, every bag back.
    await cancelSellerTrip(prisma, { ...who(), tripId: trip.id, reason: "Rain" });
    expect(await atStore("S-NEW")).toBe(58);
  });

  it("clears the shortage with a later payment, and then lets them out", async () => {
    await expect(recordSellerPayment(prisma, { ...who(), sellerId, amount: 12 })).rejects.toThrow("more than that");
    await expect(recordSellerPayment(prisma, { companyId: mill.companyId, userId: sellerUserId, sellerId, amount: 10 })).rejects.toThrow("Someone else");
    await expect(retireSeller(prisma, { ...who(), sellerId })).rejects.toThrow("still owes");
    const { owed } = await recordSellerPayment(prisma, { ...who(), sellerId, amount: 10 });
    expect(owed.toNumber()).toBe(0);
    expect((await sellerBalance(prisma, mill.companyId, sellerId)).toNumber()).toBe(0);
    const trip = await issueSellerTrip(prisma, { ...who(), sellerId, fromLocationId: mill.location("FG"), mayOverride: false, lines: [{ productId: MEAL(), bags: 5 }], at: DAY3 });
    expect(trip.overrideById).toBeNull();
  });

  it("dates a trip on the mill's day, so an issue after midnight Harare is the next day", () => {
    expect(millDay(new Date("2026-11-20T22:30:00Z")).toISOString().slice(0, 10)).toBe("2026-11-21");
  });
});
