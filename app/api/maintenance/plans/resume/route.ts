import { idsBody, maintenanceRoute, readBody } from "@/lib/maintenance/api";
import { refreshPlan } from "@/lib/maintenance/plans";
import { prisma } from "@/lib/prisma";

/** Start the ticked plans again, their next due worked out from their last service. */
export const POST = maintenanceRoute(async (session, request) => {
  const { ids } = await readBody(request, idsBody);
  const plans = await prisma.maintenancePlan.findMany({ where: { id: { in: ids }, companyId: session.user.companyId }, select: { id: true } });
  for (const plan of plans) {
    await prisma.maintenancePlan.update({ where: { id: plan.id }, data: { isActive: true } });
    await refreshPlan(prisma, plan.id);
  }
  return { done: plans.length };
});
