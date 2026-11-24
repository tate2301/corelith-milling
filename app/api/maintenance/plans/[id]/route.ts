import { z } from "zod";

import { maintenanceRoute, readBody } from "@/lib/maintenance/api";
import { PlanRefused, updatePlan } from "@/lib/maintenance/plans";
import { prisma } from "@/lib/prisma";

const body = z.object({
  equipmentId: z.string().uuid("Choose the machine or vehicle."),
  name: z.string().trim().min(1, "Name the service.").max(120),
  tasks: z.string().max(4000).nullable().optional(),
  intervalDays: z.number().int().positive().nullable().optional(),
  intervalMeter: z.number().positive().nullable().optional(),
  leadDays: z.number().int().min(0).max(90).optional(),
  autoRaise: z.boolean().optional(),
  technicianId: z.string().uuid().nullable().optional(),
  lastDoneAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/).nullable().optional(),
  lastDoneMeter: z.number().min(0).nullable().optional(),
}).partial().omit({ equipmentId: true });

/** One plan, for its sheet. */
export const GET = maintenanceRoute<{ id: string }>(async (session, _request, { id }) => {
  const plan = await prisma.maintenancePlan.findFirst({ where: { id, companyId: session.user.companyId } });
  if (!plan) throw new PlanRefused("That plan is not in this workspace.");
  return { ...plan, intervalMeter: plan.intervalMeter === null ? null : Number(plan.intervalMeter), lastDoneMeter: plan.lastDoneMeter === null ? null : Number(plan.lastDoneMeter) };
});

/** Change a plan; its next due is worked out again. */
export const PATCH = maintenanceRoute<{ id: string }>(async (session, request, { id }) => {
  const input = await readBody(request, body);
  return updatePlan(prisma, { companyId: session.user.companyId, planId: id, ...input, lastDoneAt: input.lastDoneAt === undefined ? undefined : input.lastDoneAt ? new Date(input.lastDoneAt) : null });
});
