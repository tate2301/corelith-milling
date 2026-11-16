import { millRoute } from "@/lib/milling/api";
import { prisma } from "@/lib/prisma";

/** Employees and sign-in users, for crews, supervisors and drivers. */
export const GET = millRoute(null, async ({ companyId }) => {
  const [employees, users] = await Promise.all([
    prisma.employee.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true, employeeId: true, jobTitle: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return { employees, users };
});
