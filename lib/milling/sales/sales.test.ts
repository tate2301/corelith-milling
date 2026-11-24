import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { addSeller, cancelSellerTrip, issueSellerTrip, settleSellerTrip } from "../sellers/trips";
import { recordOpeningStock } from "../stock/counts";
import { makeEmployee, makeMill, removeMill } from "../testing/fixture";
import { openTripOf, sellAtOffice, sellFromTrip, tripTillSales, voidSale } from "./sales";

let mill: Awaited<ReturnType<typeof makeMill>>;
let sellerId = "";
let sellerUserId = "";
let customerId = "";
const MEAL = () => mill.product("MEAL-10");
const who = () => ({ companyId: mill.companyId, userId: mill.userId });
const atStore = async () => Number((await prisma.millingLotBalance.aggregate({ where: { lot: { companyId: mill.companyId, productId: MEAL() }, stockLocationId: mill.location("FG") }, _sum: { quantity: true } }))._sum.quantity ?? 0);
const onHand = async () => Number((await prisma.inventoryItem.findFirstOrThrow({ where: { siteId: mill.siteId, productId: MEAL() } })).currentStock);

beforeAll(async () => {
  mill = await makeMill("till");
  await prisma.product.update({ where: { id: MEAL() }, data: { standardPrice: 6 } });
  await recordOpeningStock(prisma, { companyId: mill.companyId, userId: mill.userId, productId: MEAL(), stockLocationId: mill.location("FG"), quantity: 100, lotCode: "T-OLD" });
  const employee = await makeEmployee(mill.companyId, "Rudo Moyo");
  const user = await prisma.user.create({ data: { name: "Rudo Moyo", email: `till-${Date.now()}@x.test`, role: "CLERK", companyId: mill.companyId } });
  await prisma.employee.update({ where: { id: employee.id }, data: { userId: user.id } });
  sellerUserId = user.id;
  sellerId = (await addSeller(prisma, { companyId: mill.companyId, userId: mill.userId, employeeId: employee.id })).id;
  customerId = (await prisma.customer.create({ data: { companyId: mill.companyId, name: "Mazowe Spar" } })).id;
});
afterAll(async () => {
  await removeMill(mill.companyId);
});

describe("selling at the office", () => {
  it("takes the bags off the store's lots and core's stock now", async () => {
    const [store, core] = [await atStore(), await onHand()];
    const sale = await sellAtOffice(prisma, { ...who(), stockLocationId: mill.location("FG"), payment: "CASH", lines: [{ productId: MEAL(), bags: 4 }] });
    expect(sale.code).toMatch(/^SL-\d{6}-01$/);
    expect(Number(sale.totalAmount)).toBe(24);
    expect(await atStore()).toBe(store - 4);
    expect(await onHand()).toBe(core - 4);
  });

  it("sells only what the store has free", async () => {
    await expect(sellAtOffice(prisma, { ...who(), stockLocationId: mill.location("FG"), payment: "CASH", lines: [{ productId: MEAL(), bags: 500 }] })).rejects.toThrow("free in");
  });

  it("puts a sale on account only to a customer within their limit", async () => {
    await expect(sellAtOffice(prisma, { ...who(), stockLocationId: mill.location("FG"), payment: "ON_ACCOUNT", lines: [{ productId: MEAL(), bags: 1 }] })).rejects.toThrow("Choose the customer");
    await prisma.millingCustomerTerms.create({ data: { companyId: mill.companyId, customerId, creditLimit: 10 } });
    await expect(sellAtOffice(prisma, { ...who(), stockLocationId: mill.location("FG"), payment: "ON_ACCOUNT", customerId, lines: [{ productId: MEAL(), bags: 2 }] })).rejects.toThrow("over their limit");
    const sale = await sellAtOffice(prisma, { ...who(), stockLocationId: mill.location("FG"), payment: "ON_ACCOUNT", customerId, lines: [{ productId: MEAL(), bags: 1 }] });
    expect(sale.customerName).toBe("Mazowe Spar");
  });

  it("gives no discount at the office", async () => {
    await expect(sellAtOffice(prisma, { ...who(), stockLocationId: mill.location("FG"), payment: "CASH", lines: [{ productId: MEAL(), bags: 1, discountPerBag: 0.5 }] })).rejects.toThrow("at their price");
  });

  it("voids a sale back into the lots it came from", async () => {
    const before = await atStore();
    const sale = await sellAtOffice(prisma, { ...who(), stockLocationId: mill.location("FG"), payment: "ECOCASH", lines: [{ productId: MEAL(), bags: 3 }] });
    expect(await atStore()).toBe(before - 3);
    await expect(voidSale(prisma, { companyId: mill.companyId, userId: sellerUserId, saleId: sale.id, reason: "Wrong product", mayVoidAny: false })).rejects.toThrow("Only whoever sold it");
    await voidSale(prisma, { ...who(), saleId: sale.id, reason: "Wrong product", mayVoidAny: false });
    expect(await atStore()).toBe(before);
    await expect(voidSale(prisma, { ...who(), saleId: sale.id, reason: "Again", mayVoidAny: true })).rejects.toThrow("voided already");
  });
});

describe("selling on the road", () => {
  let tripId = "";
  it("is refused to someone with no bags out", async () => {
    await expect(sellFromTrip(prisma, { companyId: mill.companyId, userId: sellerUserId, lines: [{ productId: MEAL(), bags: 1 }] })).rejects.toThrow("no bags out");
  });

  it("sells from the seller's own trip, never more than they took, with discounts in the rules", async () => {
    tripId = (await issueSellerTrip(prisma, { ...who(), sellerId, fromLocationId: mill.location("FG"), mayOverride: false, lines: [{ productId: MEAL(), bags: 10 }] })).id;
    expect((await openTripOf(prisma, mill.companyId, sellerUserId))?.trip.id).toBe(tripId);
    const store = await atStore();
    await sellFromTrip(prisma, { companyId: mill.companyId, userId: sellerUserId, lines: [{ productId: MEAL(), bags: 6 }] });
    await sellFromTrip(prisma, { companyId: mill.companyId, userId: sellerUserId, lines: [{ productId: MEAL(), bags: 2, discountPerBag: 0.5 }] });
    expect(await atStore()).toBe(store);
    await expect(sellFromTrip(prisma, { companyId: mill.companyId, userId: sellerUserId, lines: [{ productId: MEAL(), bags: 3 }] })).rejects.toThrow("2 bags of");
    await expect(sellFromTrip(prisma, { companyId: mill.companyId, userId: sellerUserId, lines: [{ productId: MEAL(), bags: 1, discountPerBag: 1.5 }] })).rejects.toThrow("at most");
    const till = await tripTillSales(prisma, tripId);
    expect(till.bags.get(MEAL())).toBe(8);
    expect(till.cash.toNumber()).toBe(47);
    expect(till.discounts).toEqual([{ productId: MEAL(), discount: 0.5, bags: 2 }]);
  });

  it("keeps the trip from being called off, and the count from saying fewer were sold", async () => {
    await expect(cancelSellerTrip(prisma, { ...who(), tripId, reason: "Rain" })).rejects.toThrow("Settle it instead");
    await expect(settleSellerTrip(prisma, { ...who(), tripId, returned: [{ productId: MEAL(), bags: 5 }], discounts: [], cashReceived: 0 })).rejects.toThrow("The till sold 8");
    const { trip } = await settleSellerTrip(prisma, { ...who(), tripId, returned: [{ productId: MEAL(), bags: 2 }], discounts: [{ productId: MEAL(), discount: 0.5, bags: 2 }], cashReceived: 47 });
    expect(Number(trip.amountDue)).toBe(47);
    expect(Number(trip.shortage)).toBe(0);
    await expect(sellFromTrip(prisma, { companyId: mill.companyId, userId: sellerUserId, lines: [{ productId: MEAL(), bags: 1 }] })).rejects.toThrow("no bags out");
  });
});
