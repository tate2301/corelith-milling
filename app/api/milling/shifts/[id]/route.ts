import { millRefusal, millRoute } from "@/lib/milling/api";
import { prisma } from "@/lib/prisma";

/** A shift with its crew by name and duty, its batches and its stops. */
export const GET = millRoute<{ id: string }>(null, async ({ companyId }, _request, { id }) => {
  const shift = await prisma.millingShift.findFirst({ where: { id, companyId }, include: { assignments: true } });
  if (!shift) throw millRefusal("That shift is not in this workspace.");
  const [employees, duties, batches, downtime, packRuns] = await Promise.all([
    prisma.employee.findMany({ where: { companyId, id: { in: shift.assignments.map((row) => row.employeeId) } }, select: { id: true, name: true, employeeId: true } }),
    prisma.millingShiftDuty.findMany({ where: { companyId }, orderBy: { sortOrder: "asc" } }),
    prisma.millingBatch.findMany({ where: { companyId, OR: [{ shiftId: id }, { stages: { some: { shiftId: id } } }] }, orderBy: { startedAt: "asc" } }),
    prisma.millingDowntime.findMany({ where: { companyId, shiftId: id }, orderBy: { startedAt: "asc" } }),
    prisma.millingPackRun.findMany({ where: { companyId, shiftId: id } }),
  ]);
  return {
    shift: {
      ...shift,
      assignments: shift.assignments
        .map((row) => ({ ...row, name: employees.find((employee) => employee.id === row.employeeId)?.name ?? "", number: employees.find((employee) => employee.id === row.employeeId)?.employeeId ?? "" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
    duties,
    batches,
    downtime,
    bagsPacked: packRuns.reduce((sum, run) => sum + run.bagsPacked, 0),
  };
});
