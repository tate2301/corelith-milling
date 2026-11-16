import { Prisma, type PrismaClient } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";

import { millRefusal } from "../errors";
import { assertNotBlocked, raiseException } from "../exceptions/exceptions";
import { availabilityByCode } from "../maintenance/equipment";
import { nextDailyCode } from "../records/codes";
import { createLot, issueFromLot, receiveIntoLot } from "../stock/ledger";
import { CUSTOMER_ORDER_ENTITY } from "./customer-orders";

/**
 * Deliveries (plan 4.11): a truck, a driver and a destination; orders loaded
 * onto it from their reserved bags; a load check against the truck's
 * capacity; dispatch, which takes the bags off stock; proof of delivery from
 * the driver's phone; and reconciliation of every line before it closes.
 *
 * Short and damaged bags raise exceptions management decides. Returned bags
 * come back into a lot on hold for QC.
 */

type Tx = Prisma.TransactionClient;
export const DELIVERY_ENTITY = "MillingDelivery";

async function deliveryOrThrow(tx: Tx, companyId: string, deliveryId: string) {
  await tx.$queryRaw`SELECT "id" FROM "MillingDelivery" WHERE "id" = ${deliveryId} FOR UPDATE`;
  const delivery = await tx.millingDelivery.findFirst({ where: { id: deliveryId, companyId }, include: { lines: true } });
  if (!delivery) throw millRefusal("That delivery is not in this workspace.");
  return delivery;
}

async function audit(tx: Tx, companyId: string, actorId: string, id: string, action: string, payload?: Record<string, unknown>, reason?: string) {
  await writePlatformAuditEvent({ companyId, actorId, eventType: `milling.delivery.${action}`, entityType: DELIVERY_ENTITY, entityId: id, payload, reason }, tx);
}

async function vehicleOrThrow(tx: Tx | PrismaClient, companyId: string, vehicleId: string) {
  const vehicle = await tx.equipment.findFirst({ where: { id: vehicleId, site: { companyId }, category: "VEHICLE" }, select: { id: true, equipmentCode: true, name: true } });
  if (!vehicle) throw millRefusal("That is not one of the mill's vehicles.");
  return vehicle;
}

/** Load weight: bags x each product's net weight. */
async function loadKgOf(tx: Tx, lines: Array<{ productId: string; bags: number }>) {
  const products = await tx.product.findMany({ where: { id: { in: [...new Set(lines.map((line) => line.productId))] } }, select: { id: true, netWeightKg: true } });
  return lines.reduce((sum, line) => sum.plus((products.find((product) => product.id === line.productId)?.netWeightKg ?? new Prisma.Decimal(0)).times(line.bags)), new Prisma.Decimal(0));
}

export async function planDelivery(
  db: PrismaClient,
  args: { companyId: string; userId: string; vehicleId: string; driverId?: string | null; destinationId?: string | null; notes?: string | null },
) {
  return db.$transaction(async (tx) => {
    await vehicleOrThrow(tx, args.companyId, args.vehicleId);
    if (args.driverId && !(await tx.user.findFirst({ where: { id: args.driverId, companyId: args.companyId, isActive: true } }))) throw millRefusal("That driver is not in this workspace.");
    if (args.destinationId && !(await tx.millingDestination.findFirst({ where: { id: args.destinationId, companyId: args.companyId } }))) throw millRefusal("That destination is not one of the mill's.");
    const code = await nextDailyCode(tx, "millingDelivery", args.companyId, "DN");
    const delivery = await tx.millingDelivery.create({
      data: { companyId: args.companyId, code, vehicleId: args.vehicleId, driverId: args.driverId ?? null, destinationId: args.destinationId ?? null, notes: args.notes ?? null, createdById: args.userId },
    });
    await audit(tx, args.companyId, args.userId, delivery.id, "planned", { code });
    return delivery;
  });
}

/** Put a confirmed order on the truck: a line for each lot its bags are reserved from. */
export async function loadOrder(db: PrismaClient, args: { companyId: string; userId: string; deliveryId: string; orderId: string }) {
  return db.$transaction(async (tx) => {
    const delivery = await deliveryOrThrow(tx, args.companyId, args.deliveryId);
    if (!["PLANNED", "LOADING"].includes(delivery.status)) throw millRefusal(`${delivery.code} has left; nothing more goes on it.`);
    const order = await tx.millingCustomerOrder.findFirst({ where: { id: args.orderId, companyId: args.companyId }, include: { lines: true } });
    if (!order) throw millRefusal("That order is not in this workspace.");
    if (order.status !== "CONFIRMED") throw millRefusal(`${order.code} is ${order.status.toLowerCase().replace(/_/g, " ")}; only a confirmed order is loaded.`);
    for (const line of order.lines) {
      const reservations = await tx.millingReservation.findMany({ where: { companyId: args.companyId, sourceType: "MillingCustomerOrderLine", sourceId: line.id, status: "ACTIVE" } });
      for (const reservation of reservations) {
        await tx.millingDeliveryLine.create({
          data: {
            deliveryId: delivery.id,
            orderId: order.id,
            orderLineId: line.id,
            productId: line.productId,
            lotId: reservation.lotId,
            stockLocationId: reservation.stockLocationId,
            reservationId: reservation.id,
            bags: reservation.quantity.toNumber(),
          },
        });
      }
    }
    await tx.millingCustomerOrder.update({ where: { id: order.id }, data: { status: "IN_DELIVERY" } });
    const lines = await tx.millingDeliveryLine.findMany({ where: { deliveryId: delivery.id } });
    const updated = await tx.millingDelivery.update({ where: { id: delivery.id }, data: { status: "LOADING", loadKg: await loadKgOf(tx, lines) } });
    await audit(tx, args.companyId, args.userId, delivery.id, "order-loaded", { order: order.code });
    return updated;
  });
}

/** Take an order back off a truck that has not left. Its bags stay reserved for it. */
export async function unloadOrder(db: PrismaClient, args: { companyId: string; userId: string; deliveryId: string; orderId: string }) {
  return db.$transaction(async (tx) => {
    const delivery = await deliveryOrThrow(tx, args.companyId, args.deliveryId);
    if (!["PLANNED", "LOADING"].includes(delivery.status)) throw millRefusal(`${delivery.code} has left.`);
    const removed = await tx.millingDeliveryLine.deleteMany({ where: { deliveryId: delivery.id, orderId: args.orderId } });
    if (!removed.count) throw millRefusal("That order is not on this delivery.");
    await tx.millingCustomerOrder.updateMany({ where: { id: args.orderId, companyId: args.companyId, status: "IN_DELIVERY" }, data: { status: "CONFIRMED" } });
    const lines = await tx.millingDeliveryLine.findMany({ where: { deliveryId: delivery.id } });
    const updated = await tx.millingDelivery.update({ where: { id: delivery.id }, data: { loadKg: await loadKgOf(tx, lines), status: lines.length ? "LOADING" : "PLANNED" } });
    await audit(tx, args.companyId, args.userId, delivery.id, "order-unloaded");
    return updated;
  });
}

/** The load check: weight against the truck's capacity, and the truck released for work. */
export async function loadCheck(db: PrismaClient, args: { companyId: string; deliveryId: string }) {
  const delivery = await db.millingDelivery.findFirst({ where: { id: args.deliveryId, companyId: args.companyId } });
  if (!delivery) throw millRefusal("That delivery is not in this workspace.");
  const [profile, vehicle] = await Promise.all([
    db.millingVehicleProfile.findUnique({ where: { equipmentId: delivery.vehicleId } }),
    db.equipment.findUniqueOrThrow({ where: { id: delivery.vehicleId }, select: { equipmentCode: true } }),
  ]);
  const availability = (await availabilityByCode(db, args.companyId, [vehicle.equipmentCode])).get(vehicle.equipmentCode) ?? "AVAILABLE";
  const capacityKg = profile?.capacityKg ?? null;
  return {
    loadKg: delivery.loadKg,
    capacityKg,
    overBy: capacityKg && delivery.loadKg.gt(capacityKg) ? delivery.loadKg.minus(capacityKg) : null,
    vehicleAvailable: availability === "AVAILABLE",
  };
}

/**
 * Dispatch: the bags leave stock (despatch from their lots, fulfilling each
 * reservation). Over capacity raises an exception and refuses; the load must
 * be reduced, and the check passes before the truck leaves.
 */
export async function dispatchDelivery(db: PrismaClient, args: { companyId: string; userId: string; deliveryId: string; odometerOut?: number | null }) {
  const check = await loadCheck(db, args);
  if (check.overBy) {
    await db.$transaction(async (tx) => {
      const open = await tx.millingException.findFirst({ where: { companyId: args.companyId, targetType: DELIVERY_ENTITY, targetId: args.deliveryId, type: "OVER_CAPACITY", status: "OPEN" } });
      if (open) return;
      const delivery = await tx.millingDelivery.findUniqueOrThrow({ where: { id: args.deliveryId } });
      await raiseException(tx, {
        companyId: args.companyId,
        raisedById: args.userId,
        type: "OVER_CAPACITY",
        targetType: DELIVERY_ENTITY,
        targetId: args.deliveryId,
        title: `${delivery.code} is ${check.overBy!.toFixed(0)} kg over the truck's ${check.capacityKg!.toFixed(0)} kg`,
        allowedDecisions: ["REDUCE_LOAD"],
        severity: "HIGH",
      });
    });
    throw millRefusal(`The load is ${check.overBy.toFixed(0)} kg over the truck's capacity. Take an order off before it leaves.`);
  }
  if (!check.vehicleAvailable) throw millRefusal("The truck is not released for work; see Machines.");
  return db.$transaction(async (tx) => {
    const delivery = await deliveryOrThrow(tx, args.companyId, args.deliveryId);
    if (delivery.status !== "LOADING") throw millRefusal(delivery.status === "PLANNED" ? "Load an order first." : `${delivery.code} has already left.`);
    // The load now fits: an over-capacity exception is settled by the reduced load itself.
    await tx.millingException.updateMany({
      where: { companyId: args.companyId, targetType: DELIVERY_ENTITY, targetId: delivery.id, type: "OVER_CAPACITY", status: "OPEN" },
      data: { status: "DECIDED", decision: "REDUCE_LOAD", decisionNote: `Load reduced to ${delivery.loadKg.toFixed(0)} kg`, decidedById: args.userId, decidedAt: new Date() },
    });
    await assertNotBlocked(tx, { companyId: args.companyId, targetType: DELIVERY_ENTITY, targetId: delivery.id });
    for (const line of delivery.lines) {
      await issueFromLot(tx, {
        companyId: args.companyId,
        userId: args.userId,
        lotId: line.lotId,
        stockLocationId: line.stockLocationId,
        quantity: line.bags,
        reason: "DESPATCH",
        reservationId: line.reservationId,
        sourceType: DELIVERY_ENTITY,
        sourceId: delivery.id,
        reference: delivery.code,
      });
    }
    const updated = await tx.millingDelivery.update({
      where: { id: delivery.id },
      data: { status: "DISPATCHED", dispatchedAt: new Date(), odometerOut: args.odometerOut ?? null },
    });
    await audit(tx, args.companyId, args.userId, delivery.id, "dispatched", { loadKg: delivery.loadKg.toString() });
    return updated;
  });
}

export interface ProofLine {
  lineId: string;
  deliveredBags: number;
  damagedBags?: number;
  returnedBags?: number;
}

/**
 * The driver's proof of delivery, line by line. What is not delivered,
 * damaged or returned is short. Short and damaged bags raise exceptions;
 * returned bags come back into a lot on hold.
 */
export async function recordProofOfDelivery(
  db: PrismaClient,
  args: {
    companyId: string;
    userId: string;
    deliveryId: string;
    /** True when the person may manage any delivery; a driver may record only their own. */
    canManage: boolean;
    lines: ProofLine[];
    receivedBy: string;
    signatureUrl?: string | null;
    photoUrl?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  },
) {
  if (!args.receivedBy?.trim()) throw millRefusal("Who received it?");
  return db.$transaction(async (tx) => {
    const delivery = await deliveryOrThrow(tx, args.companyId, args.deliveryId);
    if (!args.canManage && delivery.driverId !== args.userId) throw millRefusal("Only the driver of this delivery records its proof.");
    if (delivery.status !== "DISPATCHED") throw millRefusal(delivery.status === "DELIVERED" ? "Proof is already recorded." : `${delivery.code} has not left yet.`);
    const missing = delivery.lines.filter((line) => !args.lines.some((entry) => entry.lineId === line.id));
    if (missing.length) throw millRefusal("Record every line on the delivery.");

    let shortTotal = 0;
    let damagedTotal = 0;
    for (const line of delivery.lines) {
      const entry = args.lines.find((row) => row.lineId === line.id)!;
      const damaged = entry.damagedBags ?? 0;
      const returned = entry.returnedBags ?? 0;
      for (const value of [entry.deliveredBags, damaged, returned]) {
        if (!Number.isInteger(value) || value < 0) throw millRefusal("Bags are whole numbers, nothing below zero.");
      }
      const short = line.bags - entry.deliveredBags - damaged - returned;
      if (short < 0) throw millRefusal("More bags are accounted for than were loaded.");
      let returnLotId: string | null = null;
      if (returned > 0) {
        const lot = await tx.millingLot.findUniqueOrThrow({ where: { id: line.lotId }, select: { code: true } });
        const back = await createLot(tx, { companyId: args.companyId, code: `RET-${delivery.code}-${lot.code}`, productId: line.productId, status: "HOLD", originType: "RETURN", originId: delivery.id });
        await receiveIntoLot(tx, {
          companyId: args.companyId,
          userId: args.userId,
          lotId: back.id,
          stockLocationId: line.stockLocationId,
          quantity: returned,
          reason: "DELIVERY_RETURN",
          sourceType: DELIVERY_ENTITY,
          sourceId: delivery.id,
          reference: delivery.code,
        });
        returnLotId = back.id;
      }
      await tx.millingDeliveryLine.update({ where: { id: line.id }, data: { deliveredBags: entry.deliveredBags, damagedBags: damaged, returnedBags: returned, shortBags: short, returnLotId } });
      shortTotal += short;
      damagedTotal += damaged;
    }
    const exceptionBase = { companyId: args.companyId, raisedById: args.userId, targetType: DELIVERY_ENTITY, targetId: delivery.id, allowedDecisions: ["WRITE_OFF", "CLAIM"] };
    if (shortTotal > 0) await raiseException(tx, { ...exceptionBase, type: "DELIVERY_SHORTAGE", title: `${delivery.code} delivered ${shortTotal} bag${shortTotal === 1 ? "" : "s"} short` });
    if (damagedTotal > 0) await raiseException(tx, { ...exceptionBase, type: "DAMAGE", title: `${delivery.code}: ${damagedTotal} bag${damagedTotal === 1 ? "" : "s"} damaged on the way` });

    const updated = await tx.millingDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "DELIVERED",
        deliveredAt: new Date(),
        receivedBy: args.receivedBy.trim(),
        signatureUrl: args.signatureUrl ?? null,
        photoUrl: args.photoUrl ?? null,
        latitude: args.latitude ?? null,
        longitude: args.longitude ?? null,
      },
    });
    await audit(tx, args.companyId, args.userId, delivery.id, "delivered", { short: shortTotal, damaged: damagedTotal });
    return updated;
  });
}

/** Close: every line reconciled, every shortage decided; trip odometer and fuel recorded. An order delivered in full is delivered. */
export async function closeDelivery(db: PrismaClient, args: { companyId: string; userId: string; deliveryId: string; odometerIn?: number | null; fuelLitres?: number | null }) {
  return db.$transaction(async (tx) => {
    const delivery = await deliveryOrThrow(tx, args.companyId, args.deliveryId);
    if (delivery.status !== "DELIVERED") throw millRefusal(delivery.status === "CLOSED" ? `${delivery.code} is closed.` : "Record proof of delivery first.");
    await assertNotBlocked(tx, { companyId: args.companyId, targetType: DELIVERY_ENTITY, targetId: delivery.id });
    if (args.odometerIn !== null && args.odometerIn !== undefined && delivery.odometerOut && new Prisma.Decimal(args.odometerIn).lt(delivery.odometerOut)) {
      throw millRefusal("The odometer reading back is below the reading out.");
    }
    const updated = await tx.millingDelivery.update({
      where: { id: delivery.id },
      data: { status: "CLOSED", closedAt: new Date(), odometerIn: args.odometerIn ?? null, fuelLitres: args.fuelLitres ?? null },
    });
    for (const orderId of [...new Set(delivery.lines.map((line) => line.orderId))]) {
      const order = await tx.millingCustomerOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const delivered = await tx.millingDeliveryLine.findMany({ where: { orderId, delivery: { status: "CLOSED" } } });
      const full = order.lines.every((line) => delivered.filter((row) => row.orderLineId === line.id).reduce((sum, row) => sum + row.bags, 0) >= line.bags);
      if (full) {
        await tx.millingCustomerOrder.update({ where: { id: orderId }, data: { status: "DELIVERED" } });
        await writePlatformAuditEvent({ companyId: args.companyId, actorId: args.userId, eventType: "milling.customer-order.delivered", entityType: CUSTOMER_ORDER_ENTITY, entityId: orderId }, tx);
      }
    }
    await audit(tx, args.companyId, args.userId, delivery.id, "closed", { odometerIn: args.odometerIn ?? null, fuelLitres: args.fuelLitres ?? null });
    return updated;
  });
}
