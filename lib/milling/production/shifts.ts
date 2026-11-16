import { Prisma, type PrismaClient } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";

import { millRefusal } from "../errors";
import { millDayStamp } from "../records/codes";
import { millSite } from "../stock/views";

/**
 * Shifts and staffing (plan 4.3). One shift of seven, 8.5 hours, day or
 * night. Times are date-times, so a night shift crosses midnight and belongs
 * to the day it started. Approval writes core Attendance, with overtime, so
 * payroll and leave work as they do for every other workspace.
 */

type Tx = Prisma.TransactionClient;
export const SHIFT_ENTITY = "MillingShift";
const ATTENDANCE = ["PRESENT", "ABSENT", "LATE", "ON_LEAVE"] as const;
export type ShiftAttendance = (typeof ATTENDANCE)[number];

/** The mill's clock is Harare's (UTC+2, no daylight saving). */
const HARARE_OFFSET_MS = 2 * 60 * 60 * 1000;

/** A local date and HH:MM at the mill, as a moment. */
export function millTime(date: string, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hours, minutes) - HARARE_OFFSET_MS);
}

/** The mill's calendar day a moment falls on, as midnight UTC, the way core stores Attendance.date. */
export function millDate(at: Date): Date {
  const local = new Date(at.getTime() + HARARE_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

/** Hours worked beyond the shift: clocked time less breaks, less the shift's length. Never below nothing. */
export function overtimeHours(args: { clockIn: Date | null; clockOut: Date | null; breakMinutes: number; shiftHours: number }): number {
  if (!args.clockIn || !args.clockOut) return 0;
  const worked = (args.clockOut.getTime() - args.clockIn.getTime()) / 3_600_000 - args.breakMinutes / 60;
  return Math.max(0, Math.round((worked - args.shiftHours) * 100) / 100);
}

async function shiftOrThrow(tx: Tx, companyId: string, shiftId: string) {
  await tx.$queryRaw`SELECT "id" FROM "MillingShift" WHERE "id" = ${shiftId} FOR UPDATE`;
  const shift = await tx.millingShift.findFirst({ where: { id: shiftId, companyId }, include: { assignments: true } });
  if (!shift) throw millRefusal("That shift is not in this workspace.");
  return shift;
}

async function audit(tx: Tx, companyId: string, actorId: string, id: string, action: string, payload?: Record<string, unknown>) {
  await writePlatformAuditEvent({ companyId, actorId, eventType: `milling.shift.${action}`, entityType: SHIFT_ENTITY, entityId: id, payload }, tx);
}

async function checkCrew(tx: Tx, companyId: string, crew: Array<{ employeeId: string; dutyId?: string | null }>) {
  const ids = [...new Set(crew.map((member) => member.employeeId))];
  if (ids.length !== crew.length) throw millRefusal("Someone is on the crew twice.");
  const found = await tx.employee.count({ where: { companyId, id: { in: ids } } });
  if (found !== ids.length) throw millRefusal("Someone on the crew is not an employee here.");
  const duties = crew.map((member) => member.dutyId).filter((id): id is string => Boolean(id));
  if (duties.length && (await tx.millingShiftDuty.count({ where: { companyId, id: { in: duties } } })) !== new Set(duties).size) {
    throw millRefusal("A duty is not one of the mill's.");
  }
}

export async function planShift(
  db: PrismaClient,
  args: {
    companyId: string;
    userId: string;
    date: string;
    kind: "DAY" | "NIGHT";
    startTime: string;
    supervisorId?: string | null;
    crew: Array<{ employeeId: string; dutyId?: string | null }>;
  },
) {
  return db.$transaction(async (tx) => {
    await checkCrew(tx, args.companyId, args.crew);
    const settings = await tx.millingSettings.findUnique({ where: { companyId: args.companyId } });
    const hours = Number(settings?.shiftHours ?? 8.5);
    const scheduledStart = millTime(args.date, args.startTime);
    const scheduledEnd = new Date(scheduledStart.getTime() + hours * 3_600_000);
    const code = `SH-${millDayStamp(scheduledStart)}-${args.kind === "DAY" ? "D" : "N"}`;
    if (await tx.millingShift.findFirst({ where: { companyId: args.companyId, code } })) throw millRefusal(`${code} is already planned.`);
    const shift = await tx.millingShift.create({
      data: {
        companyId: args.companyId,
        code,
        kind: args.kind,
        scheduledStart,
        scheduledEnd,
        supervisorId: args.supervisorId ?? null,
        createdById: args.userId,
        assignments: { create: args.crew.map((member) => ({ employeeId: member.employeeId, dutyId: member.dutyId ?? null })) },
      },
      include: { assignments: true },
    });
    await audit(tx, args.companyId, args.userId, shift.id, "planned", { code, crew: args.crew.length });
    return shift;
  });
}

export async function openShift(db: PrismaClient, args: { companyId: string; userId: string; shiftId: string; at?: Date }) {
  return db.$transaction(async (tx) => {
    const shift = await shiftOrThrow(tx, args.companyId, args.shiftId);
    if (shift.status !== "PLANNED") throw millRefusal(`${shift.code} is already ${shift.status.toLowerCase()}.`);
    const at = args.at ?? new Date();
    await tx.millingShiftAssignment.updateMany({ where: { shiftId: shift.id, attendance: "PRESENT", clockIn: null }, data: { clockIn: at } });
    const updated = await tx.millingShift.update({ where: { id: shift.id }, data: { status: "OPEN", actualStart: at } });
    await audit(tx, args.companyId, args.userId, shift.id, "opened");
    return updated;
  });
}

export async function updateAssignment(
  db: PrismaClient,
  args: {
    companyId: string;
    userId: string;
    shiftId: string;
    employeeId: string;
    dutyId?: string | null;
    attendance?: ShiftAttendance;
    clockIn?: string | null;
    clockOut?: string | null;
    breakMinutes?: number;
    absenceReason?: string | null;
    remove?: boolean;
  },
) {
  return db.$transaction(async (tx) => {
    const shift = await shiftOrThrow(tx, args.companyId, args.shiftId);
    if (!["PLANNED", "OPEN"].includes(shift.status)) throw millRefusal(`${shift.code} is ${shift.status.toLowerCase()}; its crew is fixed.`);
    const existing = shift.assignments.find((row) => row.employeeId === args.employeeId);
    if (args.remove) {
      if (existing) await tx.millingShiftAssignment.delete({ where: { id: existing.id } });
      return null;
    }
    if (!existing) await checkCrew(tx, args.companyId, [{ employeeId: args.employeeId, dutyId: args.dutyId }]);
    if (args.attendance && args.attendance !== "PRESENT" && args.attendance !== "LATE" && !(args.absenceReason ?? existing?.absenceReason)) {
      throw millRefusal("Say why they are not at work.");
    }
    const data = {
      dutyId: args.dutyId === undefined ? undefined : args.dutyId,
      attendance: args.attendance,
      clockIn: args.clockIn === undefined ? undefined : args.clockIn ? new Date(args.clockIn) : null,
      clockOut: args.clockOut === undefined ? undefined : args.clockOut ? new Date(args.clockOut) : null,
      breakMinutes: args.breakMinutes,
      absenceReason: args.absenceReason === undefined ? undefined : args.absenceReason,
    };
    return existing
      ? tx.millingShiftAssignment.update({ where: { id: existing.id }, data })
      : tx.millingShiftAssignment.create({ data: { shiftId: shift.id, employeeId: args.employeeId, ...data } });
  });
}

/** Close: clock out whoever is still in, work out overtime, and record what was left in the line. */
export async function closeShift(
  db: PrismaClient,
  args: { companyId: string; userId: string; shiftId: string; materialInProcessKg?: number | null; materialEstimated?: boolean; handoverNotes?: string | null; at?: Date },
) {
  return db.$transaction(async (tx) => {
    const shift = await shiftOrThrow(tx, args.companyId, args.shiftId);
    if (shift.status !== "OPEN") throw millRefusal(`Only an open shift is closed; ${shift.code} is ${shift.status.toLowerCase()}.`);
    const at = args.at ?? new Date();
    const settings = await tx.millingSettings.findUnique({ where: { companyId: args.companyId } });
    const shiftHours = Number(settings?.shiftHours ?? 8.5);
    for (const assignment of shift.assignments) {
      const at_work = assignment.attendance === "PRESENT" || assignment.attendance === "LATE";
      const clockOut = at_work ? assignment.clockOut ?? at : null;
      await tx.millingShiftAssignment.update({
        where: { id: assignment.id },
        data: {
          clockOut,
          overtimeHours: at_work ? overtimeHours({ clockIn: assignment.clockIn, clockOut, breakMinutes: assignment.breakMinutes, shiftHours }) : 0,
        },
      });
    }
    const updated = await tx.millingShift.update({
      where: { id: shift.id },
      data: {
        status: "CLOSED",
        actualEnd: at,
        materialInProcessKg: args.materialInProcessKg ?? null,
        materialEstimated: args.materialEstimated ?? true,
        handoverNotes: args.handoverNotes ?? null,
      },
    });
    await audit(tx, args.companyId, args.userId, shift.id, "closed", { materialInProcessKg: args.materialInProcessKg ?? null });
    return updated;
  });
}

/** The supervisor's approval: the crew's attendance and overtime go to core Attendance, for payroll. */
export async function approveShift(db: PrismaClient, args: { companyId: string; userId: string; shiftId: string }) {
  return db.$transaction(async (tx) => {
    const shift = await shiftOrThrow(tx, args.companyId, args.shiftId);
    if (shift.status !== "CLOSED") throw millRefusal(`Close ${shift.code} before approving it.`);
    const site = await millSite(tx as unknown as PrismaClient, args.companyId);
    const date = millDate(shift.scheduledStart);
    for (const assignment of shift.assignments) {
      const data = {
        companyId: args.companyId,
        siteId: site?.id ?? null,
        status: assignment.attendance as ShiftAttendance,
        overtime: Number(assignment.overtimeHours) || null,
        shiftLeaderId: shift.supervisorId,
        notes: `${shift.code}${assignment.absenceReason ? ` · ${assignment.absenceReason}` : ""}`,
      };
      await tx.attendance.upsert({
        where: { date_shift_employeeId: { date, shift: shift.kind, employeeId: assignment.employeeId } },
        update: data,
        create: { ...data, date, shift: shift.kind, employeeId: assignment.employeeId },
      });
    }
    const updated = await tx.millingShift.update({ where: { id: shift.id }, data: { status: "APPROVED", approvedById: args.userId, approvedAt: new Date() } });
    await audit(tx, args.companyId, args.userId, shift.id, "approved", { attendance: shift.assignments.length });
    return updated;
  });
}

export { ATTENDANCE as SHIFT_ATTENDANCE };
