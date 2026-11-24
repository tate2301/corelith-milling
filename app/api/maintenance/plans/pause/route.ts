import { idsBody, maintenanceRoute, readBody } from "@/lib/maintenance/api";
import { refreshPlan } from "@/lib/maintenance/plans";
import { prisma } from "@/lib/prisma";

/** Pause the ticked plans: they come due no more and raise nothing. */
export const POST = maintenanceRoute(async (session, request) => {
  const { ids } = await readBody(request, idsBody);
  const plans = await prisma.maintenancePlan.findMany({ where: { id: { in: ids }, companyId: session.user.companyId }, select: { id: true } });
  for (const plan of plans) {
    await prisma.maintenancePlan.update({ where: { id: plan.id }, data: { isActive: false } });
    await refreshPlan(prisma, plan.id);
  }
  return { done: plans.length };
});
