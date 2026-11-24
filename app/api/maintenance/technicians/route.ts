import { z } from "zod";

import { maintenanceRoute, readBody } from "@/lib/maintenance/api";
import { PlanRefused } from "@/lib/maintenance/plans";
import { prisma } from "@/lib/prisma";

const body = z.object({
  employeeId: z.string().uuid("Choose the employee."),
  trade: z.string().trim().max(80).nullable().optional(),
  hourlyRate: z.number().min(0).nullable().optional(),
});

/** The workspace's technicians, and the employees who could be made one: for the technician and plan sheets. */
export const GET = maintenanceRoute(async (session) => {
  const [technicians, employees] = await Promise.all([
    prisma.maintenanceTechnician.findMany({ where: { companyId: session.user.companyId }, include: { employee: { select: { id: true, name: true } } } }),
    prisma.employee.findMany({ where: { companyId: session.user.companyId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    technicians: technicians.map((row) => ({ id: row.id, employeeId: row.employeeId, name: row.employee.name, trade: row.trade, hourlyRate: row.hourlyRate === null ? null : Number(row.hourlyRate), isActive: row.isActive })),
    employees,
  };
});

/** Make an employee a technician (or bring one back). */
export const POST = maintenanceRoute(async (session, request) => {
  const input = await readBody(request, body);
  const employee = await prisma.employee.findFirst({ where: { id: input.employeeId, companyId: session.user.companyId }, select: { id: true } });
  if (!employee) throw new PlanRefused("That employee is not in this workspace.");
  return prisma.maintenanceTechnician.upsert({
    where: { employeeId: employee.id },
    update: { trade: input.trade ?? null, hourlyRate: input.hourlyRate ?? null, isActive: true },
    create: { companyId: session.user.companyId, employeeId: employee.id, trade: input.trade ?? null, hourlyRate: input.hourlyRate ?? null },
  });
});
