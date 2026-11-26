import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { recordStockMovement } from "@/lib/inventory/stock-movements";

import { decideAndApply } from "../exceptions/decide";
import { recordOpeningStock } from "../stock/counts";
import { lotsAgainstCore } from "../stock/ledger";
import { makeMill, removeMill } from "../testing/fixture";
import { ongoingOrder, ownerActor } from "../testing/orders";
import { cancelCustomerOrder } from "./customer-orders";
import { closeDelivery, dispatchDelivery, loadOrder, planDelivery, recordProofOfDelivery, unloadOrder } from "./deliveries";
import { matchGateSales } from "./gate-sales";

let mill: Awaited<ReturnType<typeof makeMill>>;
let customerId = "";
let truckId = "";

beforeAll(async () => {
  mill = await makeMill("distribution");
  customerId = (await prisma.customer.create({ data: { companyId: mill.companyId, name: "Mazowe Spar" } })).id;
  truckId = (await prisma.equipment.findFirstOrThrow({ where: { siteId: mill.siteId, equipmentCode: "UD-1" } })).id;
  await prisma.millingVehicleProfile.update({ where: { equipmentId: truckId }, data: { capacityKg: 8000 } });
  await recordOpeningStock(prisma, { companyId: mill.companyId, userId: mill.userId, productId: mill.product("MEAL-10"), stockLocationId: mill.location("FG"), quantity: 1000, lotCode: "FG-OLD" });
  await recordOpeningStock(prisma, { companyId: mill.companyId, userId: mill.userId, productId: mill.product("MEAL-10"), stockLocationId: mill.location("FG"), quantity: 600, lotCode: "FG-NEW" });
});
afterAll(async () => {
  await removeMill(mill.companyId);
});

const who = () => ({ companyId: mill.companyId, userId: mill.userId });
const free = async (code: string) => {
  const balance = await prisma.millingLotBalance.findFirstOrThrow({ where: { lot: { companyId: mill.companyId, code } } });
  return Number(balance.quantity) - Number(balance.reserved);
};

describe("orders and deliveries", () => {
  it("keeps the oldest bags first when an order is loaded, gives them back when it comes off, and refuses an order that cannot be met", async () => {
    const trip = await planDelivery(prisma, { ...who(), vehicleId: truckId });
    const big = await ongoingOrder(prisma, { ...who(), customerId, lines: [{ productId: mill.product("MEAL-10"), bags: 5000 }] });
    await expect(loadOrder(prisma, { ...who(), deliveryId: trip.id, orderId: big.id })).rejects.toThrow("Only 1600 bags");
    await cancelCustomerOrder(prisma, { actor: ownerActor(who()), orderId: big.id, reason: "Too big" });

    const order = await ongoingOrder(prisma, { ...who(), customerId, lines: [{ productId: mill.product("MEAL-10"), bags: 1200 }] });
    await loadOrder(prisma, { ...who(), deliveryId: trip.id, orderId: order.id });
    expect([await free("FG-OLD"), await free("FG-NEW")]).toEqual([0, 400]);
    await expect(loadOrder(prisma, { ...who(), deliveryId: trip.id, orderId: order.id })).rejects.toThrow("already on a trip");
    await unloadOrder(prisma, { ...who(), deliveryId: trip.id, orderId: order.id });
    expect([await free("FG-OLD"), await free("FG-NEW")]).toEqual([1000, 600]);
  });

  it("refuses an overloaded truck, dispatches once lightened, and reconciles a short delivery with a return", async () => {
    const heavy = await ongoingOrder(prisma, { ...who(), customerId, lines: [{ productId: mill.product("MEAL-10"), bags: 300 }] });
    const first = await prisma.millingCustomerOrder.findFirstOrThrow({ where: { companyId: mill.companyId, status: "ONGOING", id: { not: heavy.id } } });

    const delivery = await planDelivery(prisma, { ...who(), vehicleId: truckId, driverId: mill.userId });
    await loadOrder(prisma, { ...who(), deliveryId: delivery.id, orderId: first.id });
    const loaded = await loadOrder(prisma, { ...who(), deliveryId: delivery.id, orderId: heavy.id });
    expect(Number(loaded.loadKg)).toBe(15000);
    await expect(dispatchDelivery(prisma, { ...who(), deliveryId: delivery.id })).rejects.toThrow("over the truck's capacity");
    expect(await prisma.millingException.count({ where: { targetId: delivery.id, type: "OVER_CAPACITY", status: "OPEN" } })).toBe(1);

    // Take the big order off (its bags go back); the 300 bags stay on: 3000 kg.
    await unloadOrder(prisma, { ...who(), deliveryId: delivery.id, orderId: first.id });
    expect(await free("FG-OLD")).toBe(1000);
    const dispatched = await dispatchDelivery(prisma, { ...who(), deliveryId: delivery.id, odometerOut: 15200 });
    expect(dispatched.status).toBe("DISPATCHED");
    expect(await prisma.millingException.count({ where: { targetId: delivery.id, status: "OPEN" } })).toBe(0);
    expect(await free("FG-NEW")).toBe(300);

    const lines = await prisma.millingDeliveryLine.findMany({ where: { deliveryId: delivery.id } });
    const stranger = await prisma.user.create({ data: { name: "Other driver", email: `other-${Date.now()}@x.test`, role: "OPERATOR", companyId: mill.companyId } });
    await expect(
      recordProofOfDelivery(prisma, { companyId: mill.companyId, userId: stranger.id, deliveryId: delivery.id, canManage: false, receivedBy: "x", lines: [] }),
    ).rejects.toThrow("Only the driver");

    await recordProofOfDelivery(prisma, {
      ...who(),
      deliveryId: delivery.id,
      canManage: false,
      receivedBy: "S. Dube, store manager",
      latitude: -17.3,
      longitude: 31.1,
      lines: lines.map((line) => ({ lineId: line.id, deliveredBags: line.bags - 7, returnedBags: 5, damagedBags: 0 })),
    });
    const returned = await prisma.millingLot.findFirstOrThrow({ where: { companyId: mill.companyId, originType: "RETURN" }, include: { balances: true } });
    expect([returned.status, Number(returned.balances[0].quantity)]).toEqual(["HOLD", 5]);

    await expect(closeDelivery(prisma, { ...who(), deliveryId: delivery.id })).rejects.toThrow("Waiting on a decision");
    const shortage = await prisma.millingException.findFirstOrThrow({ where: { targetId: delivery.id, type: "DELIVERY_SHORTAGE" } });
    expect(shortage.title).toContain("2 bags short");
    await decideAndApply(prisma, { companyId: mill.companyId, deciderId: mill.userId, exceptionId: shortage.id, decision: "WRITE_OFF", note: "Torn bags, thrown away" });
    await expect(closeDelivery(prisma, { ...who(), deliveryId: delivery.id, odometerIn: 15000 })).rejects.toThrow("below the reading out");
    const closed = await closeDelivery(prisma, { ...who(), deliveryId: delivery.id, odometerIn: 15342, fuelLitres: 61 });
    expect(closed.status).toBe("CLOSED");
    expect((await prisma.millingCustomerOrder.findUniqueOrThrow({ where: { id: heavy.id } })).status).toBe("COMPLETE");
  });
});

describe("gate sales", () => {
  it("matches till sales to the oldest lots once, keeping core and lots in step", async () => {
    const item = await prisma.inventoryItem.findFirstOrThrow({ where: { siteId: mill.siteId, productId: mill.product("MEAL-10") } });
    const sale = await recordStockMovement({
      companyId: mill.companyId,
      userId: mill.userId,
      itemId: item.id,
      movementType: "ISSUE",
      quantity: 40,
      unit: item.unit,
      reason: "SALE",
      reference: "SALE-1",
      sourceType: "STOCK_ISSUE",
    });
    expect(sale.movement.id).toBeTruthy();
    const before = (await lotsAgainstCore(prisma, mill.companyId, mill.siteId)).find((row) => row.productId === mill.product("MEAL-10"))!;
    expect(Number(before.notInALot)).toBe(-40);

    expect(await matchGateSales(prisma, who())).toEqual({ matched: 1, unmatchedQuantity: 0 });
    expect(await matchGateSales(prisma, who())).toEqual({ matched: 0, unmatchedQuantity: 0 });
    const after = (await lotsAgainstCore(prisma, mill.companyId, mill.siteId)).find((row) => row.productId === mill.product("MEAL-10"))!;
    expect(Number(after.notInALot)).toBe(0);
  });
});
