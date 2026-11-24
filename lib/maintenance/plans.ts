import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Preventive maintenance: a plan is a service a machine or vehicle needs every
 * so many days, every so many hours or kilometres on its meter, or whichever
 * comes first.
 *
 * The next due is worked out, never typed:
 * - by date, the last service (or the plan's start) plus the interval in days;
 * - by meter, the meter at the last service plus the interval, with the day
 *   the meter is forecast to reach it, from how fast it has been climbing over
 *   its last 30 days of readings;
 * - the earlier of the two is the plan's next due, and the calendar shows it.
 *
 * A plan comes due `leadDays` before then. With `autoRaise` the service is
 * raised as a work order by itself (once; an open one is not raised again).
 * Completing that work order is the service: the plan's last done moves to
 * the day and meter it was done at, and its next due is worked out again.
 */

type Db = Prisma.TransactionClient | typeof prisma;
const DAY = 86_400_000;
/** The readings the forecast reads: how fast the meter climbed lately. */
const FORECAST_WINDOW_DAYS = 30;

export class PlanRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanRefused";
  }
}

export type PlanFigures = {
  intervalDays: number | null;
  intervalMeter: number | null;
  /** The plan's start when it has never been done. */
  startedAt: Date;
  lastDoneAt: Date | null;
  lastDoneMeter: number | null;
};

export type MeterNow = {
  current: number | null;
  /** Readings, oldest first, for the forecast. */
  readings: Array<{ reading: number; readAt: Date }>;
};

export type NextDue = { at: Date | null; meter: number | null; by: "DATE" | "METER" | null };

/** How much the meter climbs a day, from its recent readings; null when it cannot be told. */
export function dailyRate(readings: MeterNow["readings"], now: Date): number | null {
  const since = now.getTime() - FORECAST_WINDOW_DAYS * DAY;
  const recent = readings.filter((row) => row.readAt.getTime() >= since);
  const rows = recent.length >= 2 ? recent : readings.slice(-2);
  if (rows.length < 2) return null;
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const days = (last.readAt.getTime() - first.readAt.getTime()) / DAY;
  const climbed = last.reading - first.reading;
  if (days <= 0 || climbed <= 0) return null;
  return climbed / days;
}

/** The plan's next due by date and by meter, and which comes first. Pure: the sheet and the server agree. */
export function nextDue(plan: PlanFigures, meter: MeterNow, now: Date = new Date()): NextDue {
  const from = plan.lastDoneAt ?? plan.startedAt;
  const byDate = plan.intervalDays ? new Date(from.getTime() + plan.intervalDays * DAY) : null;

  let dueMeter: number | null = null;
  let byMeter: Date | null = null;
  if (plan.intervalMeter) {
    const base = plan.lastDoneMeter ?? meter.readings[0]?.reading ?? meter.current ?? 0;
    dueMeter = Math.round((base + plan.intervalMeter) * 10) / 10;
    const current = meter.current ?? base;
    if (current >= dueMeter) byMeter = now;
    else {
      const rate = dailyRate(meter.readings, now);
      if (rate) byMeter = new Date(now.getTime() + ((dueMeter - current) / rate) * DAY);
    }
  }

  if (byDate && byMeter) return byMeter < byDate ? { at: byMeter, meter: dueMeter, by: "METER" } : { at: byDate, meter: dueMeter, by: "DATE" };
  if (byMeter) return { at: byMeter, meter: dueMeter, by: "METER" };
  if (byDate) return { at: byDate, meter: dueMeter, by: "DATE" };
  // A meter plan with no forecast yet: due by its meter alone.
  return { at: null, meter: dueMeter, by: dueMeter !== null ? "METER" : null };
}

export type PlanState = "OVERDUE" | "DUE" | "BOOKED" | "OK" | "PAUSED";

/** Where a plan stands: paused, its service booked as an open work order, overdue, coming due within its lead, or fine. */
export function planState(
  plan: { isActive: boolean; nextDueAt: Date | null; nextDueMeter: number | null; leadDays: number },
  meterNow: number | null,
  hasOpenService: boolean,
  now: Date = new Date(),
): PlanState {
  if (!plan.isActive) return "PAUSED";
  if (hasOpenService) return "BOOKED";
  const meterReached = plan.nextDueMeter !== null && meterNow !== null && meterNow >= plan.nextDueMeter;
  if (meterReached || (plan.nextDueAt && plan.nextDueAt.getTime() < now.getTime())) return "OVERDUE";
  if (plan.nextDueAt && plan.nextDueAt.getTime() - now.getTime() <= plan.leadDays * DAY) return "DUE";
  return "OK";
}

const num = (value: Prisma.Decimal | null | undefined) => (value === null || value === undefined ? null : Number(value));

async function meterOf(db: Db, equipmentId: string, now: Date): Promise<MeterNow> {
  const [equipment, readings] = await Promise.all([
    db.equipment.findUnique({ where: { id: equipmentId }, select: { currentMeter: true } }),
    db.meterReading.findMany({
      where: { equipmentId, readAt: { gte: new Date(now.getTime() - 365 * DAY), lte: now } },
      orderBy: { readAt: "asc" },
      select: { reading: true, readAt: true },
    }),
  ]);
  return { current: num(equipment?.currentMeter), readings: readings.map((row) => ({ reading: Number(row.reading), readAt: row.readAt })) };
}

/** Work a plan's next due out again and keep it. */
export async function refreshPlan(db: Db, planId: string, now: Date = new Date()) {
  const plan = await db.maintenancePlan.findUnique({ where: { id: planId } });
  if (!plan) return null;
  const due = nextDue(
    { intervalDays: plan.intervalDays, intervalMeter: num(plan.intervalMeter), startedAt: plan.createdAt, lastDoneAt: plan.lastDoneAt, lastDoneMeter: num(plan.lastDoneMeter) },
    await meterOf(db, plan.equipmentId, now),
    now,
  );
  return db.maintenancePlan.update({ where: { id: plan.id }, data: { nextDueAt: due.at, nextDueMeter: due.meter, nextDueBy: due.by } });
}

/** Every active plan on a machine, after its meter moved. */
export async function refreshPlansFor(db: Db, equipmentId: string, now: Date = new Date()) {
  const plans = await db.maintenancePlan.findMany({ where: { equipmentId, isActive: true }, select: { id: true } });
  for (const plan of plans) await refreshPlan(db, plan.id, now);
}

export type PlanInput = {
  equipmentId: string;
  name: string;
  tasks?: string | null;
  intervalDays?: number | null;
  intervalMeter?: number | null;
  leadDays?: number;
  autoRaise?: boolean;
  technicianId?: string | null;
  /** When it was last done, if it ever was: the first next due counts from it. */
  lastDoneAt?: Date | null;
  lastDoneMeter?: number | null;
};

async function checkPlan(db: Db, companyId: string, input: PlanInput) {
  const equipment = await db.equipment.findFirst({ where: { id: input.equipmentId, site: { companyId } }, select: { id: true, name: true, meterType: true, isActive: true } });
  if (!equipment) throw new PlanRefused("There is no such equipment in this workspace.");
  if (!equipment.isActive) throw new PlanRefused(`${equipment.name} is retired.`);
  if (!input.name.trim()) throw new PlanRefused("Name the service.");
  const days = input.intervalDays ?? null;
  const meter = input.intervalMeter ?? null;
  if (days !== null && (!Number.isInteger(days) || days <= 0)) throw new PlanRefused("Every so many days is a whole number above nothing.");
  if (meter !== null && meter <= 0) throw new PlanRefused("Every so many on the meter is above nothing.");
  if (days === null && meter === null) throw new PlanRefused("Say how often: every so many days, on the meter, or both.");
  if (meter !== null && equipment.meterType === "NONE") throw new PlanRefused(`${equipment.name} has no meter. Give it one, or plan by days.`);
  if (input.leadDays !== undefined && (!Number.isInteger(input.leadDays) || input.leadDays < 0 || input.leadDays > 90)) throw new PlanRefused("Raise it 0 to 90 days ahead.");
  if (input.technicianId) {
    const technician = await db.employee.findFirst({ where: { id: input.technicianId, companyId }, select: { id: true } });
    if (!technician) throw new PlanRefused("That technician is not in this workspace.");
  }
  return equipment;
}

export async function createPlan(db: Db, args: { companyId: string; userId: string; now?: Date } & PlanInput) {
  await checkPlan(db, args.companyId, args);
  const plan = await db.maintenancePlan.create({
    data: {
      companyId: args.companyId,
      equipmentId: args.equipmentId,
      name: args.name.trim(),
      tasks: args.tasks?.trim() || null,
      intervalDays: args.intervalDays ?? null,
      intervalMeter: args.intervalMeter ?? null,
      leadDays: args.leadDays ?? 7,
      autoRaise: args.autoRaise ?? true,
      technicianId: args.technicianId ?? null,
      lastDoneAt: args.lastDoneAt ?? null,
      lastDoneMeter: args.lastDoneMeter ?? null,
      createdById: args.userId,
    },
  });
  return refreshPlan(db, plan.id, args.now);
}

export async function updatePlan(db: Db, args: { companyId: string; planId: string; now?: Date } & Partial<PlanInput> & { isActive?: boolean }) {
  const plan = await db.maintenancePlan.findFirst({ where: { id: args.planId, companyId: args.companyId } });
  if (!plan) throw new PlanRefused("That plan is not in this workspace.");
  const merged: PlanInput = {
    equipmentId: plan.equipmentId,
    name: args.name ?? plan.name,
    tasks: args.tasks === undefined ? plan.tasks : args.tasks,
    intervalDays: args.intervalDays === undefined ? plan.intervalDays : args.intervalDays,
    intervalMeter: args.intervalMeter === undefined ? num(plan.intervalMeter) : args.intervalMeter,
    leadDays: args.leadDays ?? plan.leadDays,
    autoRaise: args.autoRaise ?? plan.autoRaise,
    technicianId: args.technicianId === undefined ? plan.technicianId : args.technicianId,
  };
  await checkPlan(db, args.companyId, merged);
  await db.maintenancePlan.update({
    where: { id: plan.id },
    data: {
      name: merged.name.trim(),
      tasks: merged.tasks?.trim() || null,
      intervalDays: merged.intervalDays ?? null,
      intervalMeter: merged.intervalMeter ?? null,
      leadDays: merged.leadDays,
      autoRaise: merged.autoRaise,
      technicianId: merged.technicianId ?? null,
      ...(args.isActive !== undefined ? { isActive: args.isActive } : {}),
      ...(args.lastDoneAt !== undefined ? { lastDoneAt: args.lastDoneAt } : {}),
      ...(args.lastDoneMeter !== undefined ? { lastDoneMeter: args.lastDoneMeter } : {}),
    },
  });
  return refreshPlan(db, plan.id, args.now);
}

const OPEN_STATUSES = ["DRAFT", "OPEN", "IN_PROGRESS"] as const;

/** Book a plan's service as a work order now (a person's "Book it", or the plan coming due with autoRaise). Not twice. */
export async function raiseService(db: Db, args: { companyId: string; userId: string | null; planId: string; scheduledFor?: Date | null; now?: Date }) {
  const now = args.now ?? new Date();
  const plan = await db.maintenancePlan.findFirst({ where: { id: args.planId, companyId: args.companyId }, include: { equipment: { select: { name: true, isActive: true } } } });
  if (!plan) throw new PlanRefused("That plan is not in this workspace.");
  if (!plan.isActive) throw new PlanRefused(`${plan.name} is paused.`);
  if (!plan.equipment.isActive) throw new PlanRefused(`${plan.equipment.name} is retired.`);
  const open = await db.workOrder.findFirst({ where: { planId: plan.id, status: { in: [...OPEN_STATUSES] } }, select: { id: true } });
  if (open) throw new PlanRefused(`${plan.name} is booked already.`);
  const when = args.scheduledFor ?? (plan.nextDueAt && plan.nextDueAt > now ? plan.nextDueAt : now);
  return db.workOrder.create({
    data: {
      companyId: args.companyId,
      equipmentId: plan.equipmentId,
      kind: "PREVENTIVE",
      planId: plan.id,
      issue: plan.tasks ? `${plan.name}\n${plan.tasks}` : plan.name,
      scheduledFor: when,
      downtimeStart: when,
      priority: "NORMAL",
      status: "OPEN",
      technicianId: plan.technicianId,
      createdById: args.userId,
    },
  });
}

/** Every plan coming due within its lead, with autoRaise and nothing booked: its service is raised. Safe to run often. */
export async function raiseDueServices(db: Db, companyId: string, now: Date = new Date()) {
  const plans = await db.maintenancePlan.findMany({
    where: { companyId, isActive: true, autoRaise: true, equipment: { isActive: true }, workOrders: { none: { status: { in: [...OPEN_STATUSES] } } } },
    include: { equipment: { select: { currentMeter: true } } },
  });
  const raised: string[] = [];
  for (const plan of plans) {
    const state = planState({ isActive: true, nextDueAt: plan.nextDueAt, nextDueMeter: num(plan.nextDueMeter), leadDays: plan.leadDays }, num(plan.equipment.currentMeter), false, now);
    if (state !== "DUE" && state !== "OVERDUE") continue;
    const order = await raiseService(db, { companyId, userId: null, planId: plan.id, now });
    raised.push(order.id);
  }
  return raised;
}

/**
 * A service work order is done: its plan was serviced on the day and at the
 * meter the work was done, and its next due is worked out from there.
 */
export async function serviceDone(db: Db, args: { workOrderId: string; doneAt: Date; now?: Date }) {
  const order = await db.workOrder.findUnique({ where: { id: args.workOrderId }, include: { equipment: { select: { currentMeter: true } } } });
  if (!order?.planId) return null;
  await db.maintenancePlan.update({
    where: { id: order.planId },
    data: { lastDoneAt: args.doneAt, lastDoneMeter: order.meterAtService ?? order.equipment.currentMeter ?? null },
  });
  return refreshPlan(db, order.planId, args.now ?? args.doneAt);
}
