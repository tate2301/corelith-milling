import type { PrismaClient } from "@prisma/client";

import { planState } from "./plans";

/**
 * The Assets homepage and calendar, worked out on the server: what is down,
 * what is due, what the workshop has open, the fuel going out, and the
 * services on each day of a month.
 */

const DAY = 86_400_000;
const OPEN = ["OPEN", "IN_PROGRESS"] as const;
const n = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const dayKey = (at: Date) => at.toISOString().slice(0, 10);

export async function maintenanceHome(db: PrismaClient, companyId: string, now: Date = new Date()) {
  const weekAgo = new Date(now.getTime() - 6 * DAY);
  weekAgo.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [equipment, openOrders, plans, recentOrders, fuel] = await Promise.all([
    db.equipment.findMany({ where: { site: { companyId }, isActive: true }, select: { id: true, name: true, equipmentCode: true, kind: true } }),
    db.workOrder.findMany({ where: { companyId, status: { in: [...OPEN] } }, include: { equipment: { select: { name: true, equipmentCode: true } }, technician: { select: { name: true } } }, orderBy: { downtimeStart: "asc" } }),
    db.maintenancePlan.findMany({
      where: { companyId, isActive: true },
      include: { equipment: { select: { name: true, equipmentCode: true, currentMeter: true } }, workOrders: { where: { status: { in: ["DRAFT", ...OPEN] } }, select: { id: true } } },
    }),
    db.workOrder.findMany({ where: { companyId, OR: [{ createdAt: { gte: weekAgo } }, { downtimeEnd: { gte: weekAgo } }] }, select: { kind: true, status: true, createdAt: true, downtimeEnd: true } }),
    db.stockMovement.findMany({
      where: { equipmentId: { not: null }, movementType: "ISSUE", createdAt: { gte: new Date(Math.min(weekAgo.getTime(), monthStart.getTime())) }, item: { category: "FUEL", site: { companyId } } },
      select: { quantity: true, createdAt: true, equipmentId: true, item: { select: { unitCost: true } } },
    }),
  ]);

  const days = Array.from({ length: 7 }, (_, index) => new Date(weekAgo.getTime() + index * DAY));
  const series = (pick: (at: Date) => number) => days.map((day) => pick(day));
  const sameDay = (a: Date | null, b: Date) => Boolean(a) && dayKey(a!) === dayKey(b);

  const breakdownsOpen = openOrders.filter((row) => row.kind === "BREAKDOWN");
  const downIds = new Set(breakdownsOpen.map((row) => row.equipmentId));
  const planRows = plans.map((plan) => ({
    plan,
    state: planState({ isActive: true, nextDueAt: plan.nextDueAt, nextDueMeter: n(plan.nextDueMeter), leadDays: plan.leadDays }, n(plan.equipment.currentMeter), plan.workOrders.length > 0, now),
  }));
  const dueNow = planRows.filter((row) => row.state === "OVERDUE" || row.state === "DUE");
  const fuelMonth = fuel.filter((row) => row.createdAt >= monthStart);
  const fuelBy = new Map<string, { litres: number; cost: number }>();
  for (const row of fuelMonth) {
    const entry = fuelBy.get(row.equipmentId!) ?? { litres: 0, cost: 0 };
    entry.litres += Number(row.quantity);
    entry.cost += Number(row.quantity) * Number(row.item.unitCost ?? 0);
    fuelBy.set(row.equipmentId!, entry);
  }
  const nameOf = (id: string) => {
    const row = equipment.find((entry) => entry.id === id);
    return row ? `${row.name} (${row.equipmentCode})` : "Machine";
  };

  return {
    days: days.map(dayKey),
    kpis: {
      down: { value: downIds.size, of: equipment.length, bars: series((day) => recentOrders.filter((row) => row.kind === "BREAKDOWN" && sameDay(row.createdAt, day)).length) },
      open: { value: openOrders.length, bars: series((day) => recentOrders.filter((row) => sameDay(row.createdAt, day)).length) },
      due: { value: dueNow.length, overdue: dueNow.filter((row) => row.state === "OVERDUE").length, bars: series((day) => recentOrders.filter((row) => row.kind === "PREVENTIVE" && row.status === "COMPLETED" && sameDay(row.downtimeEnd, day)).length) },
      fuel: { litres: Math.round(fuelMonth.reduce((sum, row) => sum + Number(row.quantity), 0)), bars: series((day) => Math.round(fuel.filter((row) => sameDay(row.createdAt, day)).reduce((sum, row) => sum + Number(row.quantity), 0))) },
    },
    needsAction: [
      ...breakdownsOpen.map((row) => ({ id: row.id, href: `/maintenance/work-orders/${row.id}`, title: `${row.equipment.name} is down`, meta: `${row.issue.split("\n")[0]} · ${row.technician?.name ?? "Nobody on it"}`, since: row.downtimeStart.toISOString(), kind: "breakdown" as const, priority: row.priority })),
      ...dueNow.map(({ plan, state }) => ({ id: plan.id, href: `/maintenance/schedule?sheet=maint-book&id=${plan.id}`, title: `${plan.name}, ${plan.equipment.name}`, meta: state === "OVERDUE" ? "Overdue, not booked" : "Coming due, not booked", since: plan.nextDueAt?.toISOString() ?? null, kind: state === "OVERDUE" ? ("overdue" as const) : ("due" as const), priority: "NORMAL" })),
    ].slice(0, 8),
    downNow: breakdownsOpen.map((row) => ({ id: row.id, equipmentId: row.equipmentId, name: `${row.equipment.name} (${row.equipment.equipmentCode})`, issue: row.issue.split("\n")[0], since: row.downtimeStart.toISOString(), technician: row.technician?.name ?? null, status: row.status, hours: Math.round(((now.getTime() - row.downtimeStart.getTime()) / 3_600_000) * 10) / 10 })),
    comingUp: [
      ...planRows.filter((row) => row.state === "OK" && row.plan.nextDueAt && row.plan.nextDueAt.getTime() - now.getTime() <= 30 * DAY).map(({ plan }) => ({ id: plan.id, href: `/maintenance/schedule?sheet=maint-book&id=${plan.id}`, name: `${plan.name}`, equipment: `${plan.equipment.name} (${plan.equipment.equipmentCode})`, at: plan.nextDueAt!.toISOString(), booked: false })),
      ...openOrders.filter((row) => row.kind === "PREVENTIVE").map((row) => ({ id: row.id, href: `/maintenance/work-orders/${row.id}`, name: row.issue.split("\n")[0], equipment: `${row.equipment.name} (${row.equipment.equipmentCode})`, at: (row.scheduledFor ?? row.downtimeStart).toISOString(), booked: true })),
    ].sort((a, b) => a.at.localeCompare(b.at)).slice(0, 8),
    fuelBy: [...fuelBy].map(([id, entry]) => ({ id, name: nameOf(id), litres: Math.round(entry.litres), cost: Math.round(entry.cost * 100) / 100 })).sort((a, b) => b.litres - a.litres).slice(0, 6),
  };
}

export type CalendarItem = {
  id: string;
  day: string;
  kind: "due" | "forecast" | "booked" | "done" | "breakdown";
  title: string;
  equipment: string;
  href: string;
};

/** The month's services by day: due (not yet booked), forecast repeats, booked, done, and breakdowns that began. */
export async function maintenanceCalendar(db: PrismaClient, companyId: string, month: string, now: Date = new Date()) {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const inMonth = (at: Date | null) => Boolean(at) && at! >= start && at! < end;
  const [plans, orders] = await Promise.all([
    db.maintenancePlan.findMany({ where: { companyId, isActive: true }, include: { equipment: { select: { name: true, equipmentCode: true } }, workOrders: { where: { status: { in: ["DRAFT", ...OPEN] } }, select: { id: true } } } }),
    db.workOrder.findMany({
      where: { companyId, status: { not: "CANCELLED" }, OR: [{ scheduledFor: { gte: start, lt: end } }, { downtimeEnd: { gte: start, lt: end } }, { kind: "BREAKDOWN", downtimeStart: { gte: start, lt: end } }] },
      include: { equipment: { select: { name: true, equipmentCode: true } } },
    }),
  ]);
  const items: CalendarItem[] = [];
  const label = (row: { name: string; equipmentCode: string }) => `${row.name} (${row.equipmentCode})`;
  for (const plan of plans) {
    if (!plan.nextDueAt) continue;
    const booked = plan.workOrders.length > 0;
    if (!booked && inMonth(plan.nextDueAt)) items.push({ id: `${plan.id}-due`, day: dayKey(plan.nextDueAt), kind: "due", title: plan.name, equipment: label(plan.equipment), href: `/maintenance/schedule?sheet=maint-book&id=${plan.id}` });
    // A date plan repeats: the services after the next, as forecast, through the month.
    if (plan.intervalDays) {
      let at = new Date(plan.nextDueAt.getTime() + plan.intervalDays * DAY);
      for (let guard = 0; at < end && guard < 400; guard += 1, at = new Date(at.getTime() + plan.intervalDays * DAY)) {
        if (at >= start && at > now) items.push({ id: `${plan.id}-${dayKey(at)}`, day: dayKey(at), kind: "forecast", title: plan.name, equipment: label(plan.equipment), href: `/maintenance/schedule?sheet=maint-plan&id=${plan.id}` });
      }
    }
  }
  for (const order of orders) {
    const href = `/maintenance/work-orders/${order.id}`;
    const title = order.issue.split("\n")[0] ?? "Work";
    if (order.kind === "PREVENTIVE") {
      if (order.status === "COMPLETED" && inMonth(order.downtimeEnd)) items.push({ id: `${order.id}-done`, day: dayKey(order.downtimeEnd!), kind: "done", title, equipment: label(order.equipment), href });
      else if (order.status !== "COMPLETED" && inMonth(order.scheduledFor)) items.push({ id: order.id, day: dayKey(order.scheduledFor!), kind: "booked", title, equipment: label(order.equipment), href });
    } else if (inMonth(order.downtimeStart)) {
      items.push({ id: order.id, day: dayKey(order.downtimeStart), kind: "breakdown", title, equipment: label(order.equipment), href });
    }
  }
  return { month, items: items.sort((a, b) => a.day.localeCompare(b.day)) };
}
