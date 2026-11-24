import type { PrismaClient } from "@prisma/client";

import { followWorkshop } from "../maintenance/equipment";
import { millDate } from "../production/shifts";
import { millDayWindow } from "./daily";

/** The mill now, for its home page (plan 4.13): each tile something someone acts on. */
export async function millDashboard(db: PrismaClient, companyId: string) {
  await followWorkshop(db, companyId);
  const today = millDayWindow(new Date(Date.now() + 2 * 60 * 60 * 1000));
  const [shift, batches, orders, balances, products, machines, states, openStops, deliveries, exceptions, intakesWaiting, lotsOnHold] = await Promise.all([
    db.millingShift.findFirst({ where: { companyId, status: "OPEN" }, include: { assignments: true }, orderBy: { scheduledStart: "desc" } }),
    db.millingBatch.findMany({ where: { companyId, status: { in: ["OPEN", "IN_PROGRESS", "AWAITING_DECISION"] } }, include: { stages: { orderBy: { startedAt: "desc" }, take: 1 }, outputs: true }, orderBy: { startedAt: "desc" } }),
    db.millingProductionOrder.findMany({ where: { companyId, productionDate: millDate(new Date()), status: { in: ["APPROVED", "IN_PROGRESS", "COMPLETED"] } }, include: { lines: true } }),
    db.millingLotBalance.findMany({ where: { companyId, quantity: { gt: 0 } }, include: { lot: { select: { productId: true, status: true } } } }),
    db.product.findMany({ where: { companyId }, select: { id: true, code: true, name: true, unit: true, category: true } }),
    db.equipment.findMany({ where: { site: { companyId }, isActive: true }, select: { id: true, equipmentCode: true, name: true } }),
    db.millingEquipmentState.findMany({ where: { companyId, availability: { not: "AVAILABLE" } } }),
    db.millingDowntime.findMany({ where: { companyId, OR: [{ endedAt: null }, { startedAt: { gte: today.gte } }] } }),
    db.millingDelivery.findMany({ where: { companyId, status: { in: ["PLANNED", "LOADING", "DISPATCHED", "DELIVERED"] } }, select: { id: true, code: true, status: true } }),
    db.millingException.findMany({ where: { companyId, status: "OPEN" }, orderBy: { createdAt: "asc" }, take: 8 }),
    db.millingIntake.count({ where: { companyId, status: "AWAITING_QC" } }),
    db.millingLot.count({ where: { companyId, status: "HOLD" } }),
  ]);
  const maize = products.find((product) => product.code === "MAIZE");
  const maizeKg = (status: string) =>
    balances.filter((row) => row.lot.productId === maize?.id && row.lot.status === status).reduce((sum, row) => sum + Number(row.quantity) - (status === "AVAILABLE" ? Number(row.reserved) : 0), 0);
  const packed = products
    .filter((product) => product.unit === "BAG")
    .map((product) => ({
      name: product.name,
      bags: balances.filter((row) => row.lot.productId === product.id && row.lot.status === "AVAILABLE").reduce((sum, row) => sum + Number(row.quantity), 0),
      reserved: balances.filter((row) => row.lot.productId === product.id).reduce((sum, row) => sum + Number(row.reserved), 0),
    }));
  const plannedKg = orders.flatMap((order) => order.lines).reduce((sum, line) => sum + Number(line.kg), 0);
  const madeKg = (
    await db.millingBatchOutput.findMany({ where: { batch: { companyId }, createdAt: { gte: today.gte, lt: today.lt } }, select: { quantityKg: true } })
  ).reduce((sum, row) => sum + Number(row.quantityKg), 0);
  const now = Date.now();
  const week = await lastSevenDays(db, companyId, today.gte);
  return {
    week,
    shift: shift
      ? {
          id: shift.id,
          code: shift.code,
          present: shift.assignments.filter((row) => row.attendance === "PRESENT" || row.attendance === "LATE").length,
          crew: shift.assignments.length,
        }
      : null,
    batches: batches.map((batch) => ({
      id: batch.id,
      code: batch.code,
      status: batch.status,
      lastStage: batch.stages[0]?.stageCode ?? null,
      maizeKg: Number(batch.maizeIssuedKg),
      outputKg: batch.outputs.reduce((sum, row) => sum + Number(row.quantityKg), 0),
    })),
    output: { plannedKg, madeKg },
    maize: { availableKg: maizeKg("AVAILABLE"), onHoldKg: maizeKg("HOLD") },
    qc: { intakesWaiting, lotsOnHold },
    packed,
    machines: {
      down: states.map((state) => ({ ...machines.find((machine) => machine.id === state.equipmentId), availability: state.availability })),
      hoursStoppedToday: Math.round(
        openStops.reduce((sum, stop) => sum + ((stop.endedAt?.getTime() ?? now) - Math.max(stop.startedAt.getTime(), today.gte.getTime())) / 3_600_000, 0) * 10,
      ) / 10,
    },
    deliveries: {
      planned: deliveries.filter((row) => row.status === "PLANNED" || row.status === "LOADING").length,
      onTheRoad: deliveries.filter((row) => row.status === "DISPATCHED").length,
      toReconcile: deliveries.filter((row) => row.status === "DELIVERED").length,
    },
    exceptions: exceptions.map((row) => ({ id: row.id, code: row.code, title: row.title, targetType: row.targetType, targetId: row.targetId, createdAt: row.createdAt })),
  };
}

const DAY_MS = 86_400_000;

/**
 * The last seven mill days, today last: maize received, meal made, bags out
 * (despatched or sold by a seller) and hours machines stood, for the
 * Overview's tiles.
 */
async function lastSevenDays(db: PrismaClient, companyId: string, todayStart: Date) {
  const starts = Array.from({ length: 7 }, (_, index) => new Date(todayStart.getTime() - (6 - index) * DAY_MS));
  const window = { gte: starts[0]!, lt: new Date(todayStart.getTime() + DAY_MS) };
  const [intakes, outputs, meal, deliveries, trips, stops] = await Promise.all([
    db.millingIntake.findMany({ where: { companyId, receivedAt: window, status: { not: "REJECTED" } }, select: { netKg: true, receivedAt: true } }),
    db.millingBatchOutput.findMany({ where: { batch: { companyId }, createdAt: window }, select: { quantityKg: true, productId: true, createdAt: true } }),
    db.product.findMany({ where: { companyId, code: { startsWith: "MEAL" } }, select: { id: true } }),
    db.millingDelivery.findMany({ where: { companyId, dispatchedAt: window }, select: { dispatchedAt: true, lines: { select: { bags: true } } } }),
    db.millingSellerTrip.findMany({ where: { companyId, issuedAt: window, status: "SETTLED" }, select: { issuedAt: true, lines: { select: { bagsSold: true } } } }),
    db.millingDowntime.findMany({ where: { companyId, startedAt: { lt: window.lt }, OR: [{ endedAt: null }, { endedAt: { gte: window.gte } }] }, select: { startedAt: true, endedAt: true } }),
  ]);
  const mealIds = new Set(meal.map((row) => row.id));
  const dayOf = (at: Date | null) => (at ? starts.findIndex((start) => at >= start && at.getTime() < start.getTime() + DAY_MS) : -1);
  const bucket = <T,>(rows: T[], at: (row: T) => Date | null, amount: (row: T) => number) => {
    const days = starts.map(() => 0);
    for (const row of rows) {
      const index = dayOf(at(row));
      if (index >= 0) days[index] += amount(row);
    }
    return days;
  };
  const clock = Date.now();
  return {
    days: starts.map((start) => new Date(start.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10)),
    maizeKg: bucket(intakes, (row) => row.receivedAt, (row) => Number(row.netKg)),
    mealKg: bucket(outputs.filter((row) => mealIds.has(row.productId)), (row) => row.createdAt, (row) => Number(row.quantityKg)),
    bagsOut: starts.map((_, index) => bucket(deliveries, (row) => row.dispatchedAt, (row) => row.lines.reduce((sum, line) => sum + line.bags, 0))[index]! + bucket(trips, (row) => row.issuedAt, (row) => row.lines.reduce((sum, line) => sum + (line.bagsSold ?? 0), 0))[index]!),
    downtimeHours: starts.map((start) => {
      const end = start.getTime() + DAY_MS;
      const hours = stops.reduce((sum, stop) => sum + Math.max(0, Math.min(stop.endedAt?.getTime() ?? clock, end, clock) - Math.max(stop.startedAt.getTime(), start.getTime())) / 3_600_000, 0);
      return Math.round(hours * 10) / 10;
    }),
  };
}
