import { prisma } from "@/lib/prisma";
import type { ScheduledJob } from "@/lib/scheduled-jobs/schedule";

import { raiseDueServices, refreshPlan } from "./plans";

/**
 * Maintenance's scheduled work (`app/api/cron/tick`): at 05:30 every plan's
 * next due is worked out again (a date plan's forecast moves with its meter's
 * pace) and every service now within its lead is raised as a work order.
 */
export const MAINTENANCE_JOBS: ScheduledJob[] = [
  {
    name: "maintenance-services-due",
    when: { dailyAt: "05:30" },
    run: async (now) => {
      const plans = await prisma.maintenancePlan.findMany({ where: { isActive: true }, select: { id: true, companyId: true } });
      for (const plan of plans) await refreshPlan(prisma, plan.id, now);
      let raised = 0;
      for (const companyId of new Set(plans.map((plan) => plan.companyId))) raised += (await raiseDueServices(prisma, companyId, now)).length;
      return `${plans.length} plans worked out, ${raised} services raised`;
    },
  },
];
