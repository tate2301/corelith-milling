import { prisma } from "@/lib/prisma";
import { METER_UNIT } from "@/lib/maintenance/meters";
import { planState } from "@/lib/maintenance/plans";
import { result } from "@/lib/reports/loaders/shared";
import type { ReportContext, ReportLoader, ReportRow } from "@/lib/reports/types";
import { DEFAULT_TIME_ZONE } from "@/lib/workspace/format";

/** The Assets lists (lib/reports/definitions/maintenance.ts): a workspace's machines are few hundred at most, so each loads whole. */

const ZONE = DEFAULT_TIME_ZONE;
const DAY = 86_400_000;
const OPEN = ["OPEN", "IN_PROGRESS"] as const;
const isoDay = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
const dayText = (value: Date) => value.toLocaleDateString("en-GB", { timeZone: ZONE, day: "numeric", month: "short", year: "numeric" });
const shortDay = (value: Date) => value.toLocaleDateString("en-GB", { timeZone: ZONE, day: "numeric", month: "short" });
const clock = (value: Date) => value.toLocaleTimeString("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit" });
const n = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const distinct = (values: Array<string | null | undefined>) => [...new Set(values.filter((value): value is string => Boolean(value)))].sort().map((value) => ({ value, label: value }));
const title = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ");
const meterText = (value: unknown, type: string) => (value === null || value === undefined || type === "NONE" ? null : `${Number(value).toLocaleString("en-GB")} ${METER_UNIT[type as "HOURS" | "KM"]}`);
const STATE: Record<string, string> = { DRAFT: "Draft", OPEN: "Open", IN_PROGRESS: "In progress", COMPLETED: "Done", CANCELLED: "Cancelled" };
const PLAN_STATE: Record<string, string> = { OVERDUE: "Overdue", DUE: "Due", BOOKED: "Booked", OK: "Ahead", PAUSED: "Paused" };
const URGENCY: Record<string, number> = { CRITICAL: 4, HIGH: 3, NORMAL: 2, LOW: 1 };

async function employeeNames(companyId: string, ids: Array<string | null>) {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!wanted.length) return new Map<string, string>();
  const rows = await prisma.employee.findMany({ where: { companyId, id: { in: wanted } }, select: { id: true, name: true } });
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** "Every 90 days or 5,000 km, whichever first". */
export function everyText(plan: { intervalDays: number | null; intervalMeter: unknown }, meterType: string) {
  const days = plan.intervalDays ? `${plan.intervalDays} days` : null;
  const meter = plan.intervalMeter !== null && plan.intervalMeter !== undefined && meterType !== "NONE" ? meterText(plan.intervalMeter, meterType) : null;
  return days && meter ? `${days} or ${meter}, whichever first` : (days ?? meter ?? "—");
}

/** "12 Mar, or at 15,000 km". */
export function dueText(plan: { nextDueAt: Date | null; nextDueMeter: unknown }, meterType: string) {
  const at = plan.nextDueAt ? dayText(plan.nextDueAt) : null;
  const meter = meterText(plan.nextDueMeter, meterType);
  return at && meter ? `${at}, or at ${meter}` : (at ?? (meter ? `At ${meter}` : "—"));
}

const equipment: ReportLoader = {
  load: async (ctx: ReportContext) => {
    const rows = await prisma.equipment.findMany({
      where: { site: { companyId: ctx.companyId } },
      include: {
        site: { select: { name: true } },
        workOrders: { where: { status: { in: [...OPEN] } }, select: { kind: true, status: true } },
        maintenancePlans: { where: { isActive: true }, select: { name: true, nextDueAt: true, nextDueMeter: true }, orderBy: { nextDueAt: "asc" } },
      },
      orderBy: { equipmentCode: "asc" },
    });
    return result(
      rows.map((row): ReportRow => {
        const down = row.workOrders.some((order) => order.kind === "BREAKDOWN");
        const inService = row.workOrders.some((order) => order.kind === "PREVENTIVE" && order.status === "IN_PROGRESS");
        const stateKey = !row.isActive ? "RETIRED" : down ? "DOWN" : inService ? "SERVICE" : "WORKING";
        const next = row.maintenancePlans.find((plan) => plan.nextDueAt) ?? row.maintenancePlans[0];
        return {
          id: row.id,
          code: row.equipmentCode,
          name: row.name,
          category: title(row.category),
          kindKey: row.kind,
          activeKey: row.isActive ? "yes" : "no",
          hasMeter: row.meterType === "NONE" ? "no" : "yes",
          registration: row.registrationNumber,
          make: [row.make, row.model].filter(Boolean).join(" ") || null,
          stateKey,
          state: { RETIRED: "Retired", DOWN: "Down", SERVICE: "In service", WORKING: "Working" }[stateKey],
          meter: meterText(row.currentMeter, row.meterType),
          nextService: next ? `${next.name}: ${dueText(next, row.meterType)}` : null,
          nextServiceAt: next?.nextDueAt?.toISOString() ?? null,
          openOrders: row.workOrders.length,
          site: row.site.name,
        };
      }),
    );
  },
  options: async (ctx) => {
    const rows = await prisma.equipment.findMany({ where: { site: { companyId: ctx.companyId } }, select: { category: true, site: { select: { name: true } } } });
    return { category: distinct(rows.map((row) => title(row.category))), site: distinct(rows.map((row) => row.site.name)) };
  },
};

const workOrders: ReportLoader = {
  load: async (ctx) => {
    const rows = await prisma.workOrder.findMany({
      where: { companyId: ctx.companyId },
      include: { equipment: { select: { name: true, equipmentCode: true } }, technician: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });
    const now = Date.now();
    return result(
      rows.map((row): ReportRow => {
        const end = row.downtimeEnd?.getTime() ?? (row.status === "COMPLETED" || row.status === "CANCELLED" ? row.updatedAt.getTime() : now);
        const preventive = row.kind === "PREVENTIVE";
        const when = preventive ? (row.scheduledFor ?? row.downtimeStart) : row.downtimeStart;
        return {
          id: row.id,
          ref: `WO-${row.id.slice(0, 6).toUpperCase()}`,
          equipmentId: row.equipmentId,
          planId: row.planId,
          equipment: `${row.equipment.name} (${row.equipment.equipmentCode})`,
          issue: row.issue.split("\n")[0],
          kind: preventive ? "Service" : "Breakdown",
          priority: title(row.priority),
          urgency: URGENCY[row.priority] ?? 2,
          stateKey: row.status,
          state: STATE[row.status] ?? row.status,
          technician: row.technician?.name ?? null,
          when: `${shortDay(when)} ${clock(when)}`,
          // A service is planned downtime; a breakdown's runs until it is mended.
          downHours: preventive && row.status !== "COMPLETED" ? null : Math.max(0, Math.round(((end - row.downtimeStart.getTime()) / 3_600_000) * 10) / 10),
          cost: (row.partsCost ?? 0) + (row.laborCost ?? 0),
          raisedAt: row.createdAt.toISOString(),
          date: isoDay(row.createdAt),
        };
      }),
    );
  },
  options: async (ctx) => {
    const rows = await prisma.workOrder.findMany({ where: { companyId: ctx.companyId, technicianId: { not: null } }, select: { technician: { select: { name: true } } }, distinct: ["technicianId"] });
    return { technician: distinct(rows.map((row) => row.technician?.name)) };
  },
};

const plans: ReportLoader = {
  load: async (ctx) => {
    const rows = await prisma.maintenancePlan.findMany({
      where: { companyId: ctx.companyId },
      include: {
        equipment: { select: { name: true, equipmentCode: true, meterType: true, currentMeter: true } },
        workOrders: { where: { status: { in: ["DRAFT", ...OPEN] } }, select: { id: true } },
      },
      orderBy: { nextDueAt: "asc" },
    });
    const names = await employeeNames(ctx.companyId, rows.map((row) => row.technicianId));
    return result(
      rows.map((row): ReportRow => {
        const key = planState({ isActive: row.isActive, nextDueAt: row.nextDueAt, nextDueMeter: n(row.nextDueMeter), leadDays: row.leadDays }, n(row.equipment.currentMeter), row.workOrders.length > 0);
        return {
          id: row.id,
          equipmentId: row.equipmentId,
          equipment: `${row.equipment.name} (${row.equipment.equipmentCode})`,
          name: row.name,
          every: everyText(row, row.equipment.meterType),
          lastDone: row.lastDoneAt ? shortDay(row.lastDoneAt) : "Never",
          nextDue: dueText(row, row.equipment.meterType),
          nextDueAt: row.nextDueAt?.toISOString() ?? null,
          stateKey: key,
          state: PLAN_STATE[key],
          technician: row.technicianId ? (names.get(row.technicianId) ?? null) : null,
        };
      }),
    );
  },
  options: async (ctx) => {
    const rows = await prisma.maintenancePlan.findMany({ where: { companyId: ctx.companyId, technicianId: { not: null } }, select: { technician: { select: { name: true } } } });
    return { technician: distinct(rows.map((row) => row.technician?.name)) };
  },
};

const technicians: ReportLoader = {
  load: async (ctx) => {
    const monthStart = new Date(Date.now() - 30 * DAY);
    const rows = await prisma.maintenanceTechnician.findMany({ where: { companyId: ctx.companyId }, include: { employee: { select: { id: true, name: true } } } });
    const [open, done, planCounts] = await Promise.all([
      prisma.workOrder.groupBy({ by: ["technicianId"], where: { companyId: ctx.companyId, status: { in: [...OPEN] } }, _count: true }),
      prisma.workOrder.groupBy({ by: ["technicianId"], where: { companyId: ctx.companyId, status: "COMPLETED", updatedAt: { gte: monthStart } }, _count: true }),
      prisma.maintenancePlan.groupBy({ by: ["technicianId"], where: { companyId: ctx.companyId, isActive: true }, _count: true }),
    ]);
    const count = (list: Array<{ technicianId: string | null; _count: number }>, id: string) => list.find((row) => row.technicianId === id)?._count ?? 0;
    return result(
      rows.map((row): ReportRow => ({
        id: row.id,
        employeeId: row.employeeId,
        name: row.employee.name,
        trade: row.trade,
        rate: n(row.hourlyRate),
        activeKey: row.isActive ? "yes" : "no",
        open: count(open, row.employeeId),
        doneMonth: count(done, row.employeeId),
        plans: count(planCounts, row.employeeId),
      })),
    );
  },
  options: async (ctx) => ({ trade: distinct((await prisma.maintenanceTechnician.findMany({ where: { companyId: ctx.companyId }, select: { trade: true } })).map((row) => row.trade)) }),
};

/** Fuel issued to equipment: an ISSUE of a FUEL stock line with an equipment on it. */
async function fuelIssues(companyId: string) {
  return prisma.stockMovement.findMany({
    where: { equipmentId: { not: null }, movementType: "ISSUE", item: { category: "FUEL", site: { companyId } } },
    include: {
      item: { select: { name: true, unit: true, unitCost: true } },
      equipment: { select: { id: true, name: true, equipmentCode: true, meterType: true, kind: true } },
      issuedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });
}

const fuelLog: ReportLoader = {
  load: async (ctx) => {
    const rows = await fuelIssues(ctx.companyId);
    return result(
      rows.map((row): ReportRow => ({
        id: row.id,
        equipmentId: row.equipmentId,
        equipment: row.equipment ? `${row.equipment.name} (${row.equipment.equipmentCode})` : null,
        fuel: row.item.name,
        litres: Number(row.quantity),
        meter: meterText(row.meterReading, row.equipment?.meterType ?? "NONE"),
        // At the stock line's cost now: a movement keeps no cost of its own.
        cost: row.item.unitCost === null ? null : Math.round(Number(row.item.unitCost) * Number(row.quantity) * 100) / 100,
        by: row.issuedBy?.name ?? null,
        reference: row.reference,
        when: `${shortDay(row.createdAt)} ${clock(row.createdAt)}`,
        issuedAt: row.createdAt.toISOString(),
        date: isoDay(row.createdAt),
      })),
    );
  },
  options: async (ctx) => {
    const rows = await fuelIssues(ctx.companyId);
    return { machine: distinct(rows.map((row) => (row.equipment ? `${row.equipment.name} (${row.equipment.equipmentCode})` : null))), fuel: distinct(rows.map((row) => row.item.name)) };
  },
};

const fuelUsage: ReportLoader = {
  load: async (ctx) => {
    const issues = await fuelIssues(ctx.companyId);
    const ids = [...new Set(issues.map((row) => row.equipmentId!).filter(Boolean))];
    const readings = ids.length ? await prisma.meterReading.findMany({ where: { equipmentId: { in: ids } }, orderBy: { readAt: "asc" }, select: { equipmentId: true, reading: true, readAt: true } }) : [];
    const months = new Map<string, { equipmentId: string; name: string; meterType: string; kind: string; month: string; litres: number; cost: number }>();
    for (const row of issues) {
      if (!row.equipment) continue;
      const month = isoDay(row.createdAt).slice(0, 7);
      const key = `${row.equipment.id}|${month}`;
      const entry = months.get(key) ?? { equipmentId: row.equipment.id, name: `${row.equipment.name} (${row.equipment.equipmentCode})`, meterType: row.equipment.meterType, kind: row.equipment.kind, month, litres: 0, cost: 0 };
      entry.litres += Number(row.quantity);
      entry.cost += Number(row.item.unitCost ?? 0) * Number(row.quantity);
      months.set(key, entry);
    }
    return result(
      [...months.values()].map((entry): ReportRow => {
        // How far the meter went in the month: its last reading less the last one before the month.
        const start = new Date(`${entry.month}-01T00:00:00Z`);
        const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
        const mine = readings.filter((row) => row.equipmentId === entry.equipmentId);
        const before = [...mine].reverse().find((row) => row.readAt < start) ?? mine.find((row) => row.readAt >= start && row.readAt < end);
        const last = [...mine].reverse().find((row) => row.readAt < end);
        const moved = before && last ? Math.max(0, Number(last.reading) - Number(before.reading)) : 0;
        const km = entry.meterType === "KM" ? moved : 0;
        const hours = entry.meterType === "HOURS" ? moved : 0;
        return {
          id: `${entry.equipmentId}-${entry.month}`,
          equipmentId: entry.equipmentId,
          equipment: entry.name,
          kindKey: entry.kind,
          month: new Date(`${entry.month}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric" }),
          litres: Math.round(entry.litres * 10) / 10,
          cost: Math.round(entry.cost * 100) / 100,
          km: km || null,
          hours: hours || null,
          per100km: km ? Math.round((entry.litres / km) * 1000) / 10 : null,
          perHour: hours ? Math.round((entry.litres / hours) * 10) / 10 : null,
          date: `${entry.month}-01`,
        };
      }),
    );
  },
};

export const MAINTENANCE_LOADERS: Record<string, ReportLoader> = {
  "assets-equipment": equipment,
  "assets-work-orders": workOrders,
  "assets-plans": plans,
  "assets-technicians": technicians,
  "assets-fuel-log": fuelLog,
  "assets-fuel-usage": fuelUsage,
};
