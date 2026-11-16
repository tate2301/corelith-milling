import type { Prisma, PrismaClient } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";

import { millRefusal } from "../errors";
import { raiseException } from "../exceptions/exceptions";

/**
 * Machines at the mill (plan 4.10): down, in repair, awaiting release, or
 * available. A breakdown stops the machine, raises an exception and a core
 * work order for the workshop; only a supervisor releases it back to work, and
 * that closes the downtime. A machine that is not available cannot be named
 * in a stage record.
 */

type Tx = Prisma.TransactionClient;
export const EQUIPMENT_ENTITY = "MillingEquipment";
export const AVAILABILITY = ["AVAILABLE", "DOWN", "IN_REPAIR", "AWAITING_RELEASE"] as const;

/** The state of each machine named, by code; a machine never recorded is available. */
export async function availabilityByCode(tx: Tx | PrismaClient, companyId: string, codes: string[]) {
  if (!codes.length) return new Map<string, string>();
  const equipment = await tx.equipment.findMany({ where: { site: { companyId }, equipmentCode: { in: codes } }, select: { id: true, equipmentCode: true } });
  const states = await tx.millingEquipmentState.findMany({ where: { companyId, equipmentId: { in: equipment.map((row) => row.id) } } });
  return new Map(equipment.map((row) => [row.equipmentCode, states.find((state) => state.equipmentId === row.id)?.availability ?? "AVAILABLE"]));
}

export async function assertAvailable(tx: Tx, companyId: string, codes: string[]) {
  const states = await availabilityByCode(tx, companyId, codes);
  const unknown = codes.filter((code) => !states.has(code));
  if (unknown.length) throw millRefusal(`No machine ${unknown.join(", ")} at the mill.`);
  const down = codes.filter((code) => states.get(code) !== "AVAILABLE");
  if (down.length) throw millRefusal(`${down.join(", ")} ${down.length === 1 ? "is" : "are"} not released for work.`);
}

async function setState(tx: Tx, companyId: string, equipmentId: string, availability: (typeof AVAILABILITY)[number]) {
  await tx.millingEquipmentState.upsert({
    where: { equipmentId },
    update: { availability },
    create: { companyId, equipmentId, availability },
  });
}

async function equipmentOrThrow(tx: Tx, companyId: string, equipmentId: string) {
  const equipment = await tx.equipment.findFirst({ where: { id: equipmentId, site: { companyId } }, select: { id: true, equipmentCode: true, name: true } });
  if (!equipment) throw millRefusal("That machine is not at the mill.");
  return equipment;
}

export async function reportDowntime(
  db: PrismaClient,
  args: {
    companyId: string;
    userId: string;
    equipmentId?: string | null;
    category: "BREAKDOWN" | "POWER" | "MATERIAL" | "PLANNED" | "OTHER";
    cause: string;
    startedAt?: Date;
    batchId?: string | null;
    shiftId?: string | null;
    stageCode?: string | null;
  },
) {
  if (args.cause.trim().length < 3) throw millRefusal("Say what stopped.");
  if (args.category === "BREAKDOWN" && !args.equipmentId) throw millRefusal("Name the machine that broke down.");
  return db.$transaction(async (tx) => {
    const equipment = args.equipmentId ? await equipmentOrThrow(tx, args.companyId, args.equipmentId) : null;
    if (args.batchId && !(await tx.millingBatch.findFirst({ where: { id: args.batchId, companyId: args.companyId } }))) throw millRefusal("That batch is not at the mill.");
    let workOrderId: string | null = null;
    if (equipment && args.category === "BREAKDOWN") {
      const workOrder = await tx.workOrder.create({
        data: { companyId: args.companyId, equipmentId: equipment.id, issue: args.cause.trim(), downtimeStart: args.startedAt ?? new Date(), createdById: args.userId },
        select: { id: true },
      });
      workOrderId = workOrder.id;
      await setState(tx, args.companyId, equipment.id, "DOWN");
    }
    const downtime = await tx.millingDowntime.create({
      data: {
        companyId: args.companyId,
        equipmentId: equipment?.id ?? null,
        batchId: args.batchId ?? null,
        shiftId: args.shiftId ?? null,
        stageCode: args.stageCode ?? null,
        category: args.category,
        cause: args.cause.trim(),
        startedAt: args.startedAt ?? new Date(),
        workOrderId,
        reportedById: args.userId,
      },
    });
    if (equipment && args.category === "BREAKDOWN") {
      await raiseException(tx, {
        companyId: args.companyId,
        raisedById: args.userId,
        type: "BREAKDOWN",
        targetType: EQUIPMENT_ENTITY,
        targetId: equipment.id,
        title: `${equipment.equipmentCode} ${equipment.name} broke down: ${args.cause.trim()}`,
        allowedDecisions: ["CONTINUE", "STOP"],
        blocking: false,
        severity: "HIGH",
      });
    }
    return downtime;
  });
}

/** The workshop says it is fixed: the machine waits for the supervisor's release. */
export async function markRepaired(db: PrismaClient, args: { companyId: string; userId: string; equipmentId: string; inRepair?: boolean }) {
  return db.$transaction(async (tx) => {
    const equipment = await equipmentOrThrow(tx, args.companyId, args.equipmentId);
    await setState(tx, args.companyId, equipment.id, args.inRepair ? "IN_REPAIR" : "AWAITING_RELEASE");
    await writePlatformAuditEvent({ companyId: args.companyId, actorId: args.userId, eventType: args.inRepair ? "milling.equipment.in-repair" : "milling.equipment.repaired", entityType: EQUIPMENT_ENTITY, entityId: equipment.id }, tx);
  });
}

/** The supervisor's release: back to work, its downtime closed, its work order completed. */
export async function releaseMachine(db: PrismaClient, args: { companyId: string; userId: string; equipmentId: string; at?: Date; note?: string | null }) {
  return db.$transaction(async (tx) => {
    const equipment = await equipmentOrThrow(tx, args.companyId, args.equipmentId);
    const at = args.at ?? new Date();
    const open = await tx.millingDowntime.findMany({ where: { companyId: args.companyId, equipmentId: equipment.id, endedAt: null } });
    for (const downtime of open) {
      await tx.millingDowntime.update({ where: { id: downtime.id }, data: { endedAt: at, releasedById: args.userId } });
      if (downtime.workOrderId) {
        await tx.workOrder.updateMany({
          where: { id: downtime.workOrderId, companyId: args.companyId, status: { in: ["OPEN", "IN_PROGRESS", "DRAFT"] } },
          data: { status: "COMPLETED", downtimeEnd: at, workDone: args.note ?? undefined },
        });
      }
    }
    await setState(tx, args.companyId, equipment.id, "AVAILABLE");
    await writePlatformAuditEvent({ companyId: args.companyId, actorId: args.userId, eventType: "milling.equipment.released", entityType: EQUIPMENT_ENTITY, entityId: equipment.id, reason: args.note ?? undefined }, tx);
    return { closed: open.length };
  });
}

/** Close a stop that was not a breakdown (power back, maize arrived). */
export async function endDowntime(db: PrismaClient, args: { companyId: string; userId: string; downtimeId: string; at?: Date }) {
  const downtime = await db.millingDowntime.findFirst({ where: { id: args.downtimeId, companyId: args.companyId } });
  if (!downtime) throw millRefusal("That stop is not at the mill.");
  if (downtime.endedAt) throw millRefusal("That stop has already ended.");
  if (downtime.category === "BREAKDOWN") throw millRefusal("A breakdown ends when the supervisor releases the machine.");
  return db.millingDowntime.update({ where: { id: downtime.id }, data: { endedAt: args.at ?? new Date() } });
}

export async function recordGeneratorRun(
  db: PrismaClient,
  args: { companyId: string; userId: string; equipmentId?: string | null; startedAt: Date; endedAt: Date; litres: number; meterStart?: number | null; meterEnd?: number | null; reason?: string | null },
) {
  if (args.endedAt <= args.startedAt) throw millRefusal("The run must end after it starts.");
  if (!(args.litres >= 0)) throw millRefusal("Enter the litres used.");
  if (args.meterStart !== null && args.meterStart !== undefined && args.meterEnd !== null && args.meterEnd !== undefined && args.meterEnd < args.meterStart) {
    throw millRefusal("The closing meter reading is below the opening one.");
  }
  if (args.equipmentId) await db.$transaction((tx) => equipmentOrThrow(tx, args.companyId, args.equipmentId!));
  return db.millingGeneratorRun.create({
    data: {
      companyId: args.companyId,
      equipmentId: args.equipmentId ?? null,
      startedAt: args.startedAt,
      endedAt: args.endedAt,
      litres: args.litres,
      meterStart: args.meterStart ?? null,
      meterEnd: args.meterEnd ?? null,
      reason: args.reason ?? null,
      recordedById: args.userId,
    },
  });
}

/**
 * Follow the workshop. A breakdown's work order lives in core Maintenance;
 * when the workshop starts it, the machine is in repair, and when they
 * complete it, the machine waits for the supervisor's release. Only moves a
 * machine forward, never back to available: that stays the supervisor's call.
 */
export async function followWorkshop(db: PrismaClient, companyId: string) {
  const stops = await db.millingDowntime.findMany({
    where: { companyId, endedAt: null, workOrderId: { not: null }, equipmentId: { not: null } },
    select: { equipmentId: true, workOrderId: true },
  });
  if (!stops.length) return 0;
  const [orders, states] = await Promise.all([
    db.workOrder.findMany({ where: { companyId, id: { in: stops.map((stop) => stop.workOrderId!) } }, select: { id: true, status: true } }),
    db.millingEquipmentState.findMany({ where: { companyId, equipmentId: { in: stops.map((stop) => stop.equipmentId!) } } }),
  ]);
  let moved = 0;
  for (const stop of stops) {
    const order = orders.find((entry) => entry.id === stop.workOrderId);
    const state = states.find((entry) => entry.equipmentId === stop.equipmentId);
    if (!order || !state) continue;
    const next = order.status === "COMPLETED" ? "AWAITING_RELEASE" : order.status === "IN_PROGRESS" ? "IN_REPAIR" : null;
    const rank = { DOWN: 0, IN_REPAIR: 1, AWAITING_RELEASE: 2, AVAILABLE: 3 } as Record<string, number>;
    if (next && rank[next] > (rank[state.availability] ?? 3)) {
      await db.millingEquipmentState.update({ where: { id: state.id }, data: { availability: next } });
      moved += 1;
    }
  }
  return moved;
}
