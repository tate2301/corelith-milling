import { z } from "zod";

import { maintenanceRoute, readBody } from "@/lib/maintenance/api";
import { createPlan } from "@/lib/maintenance/plans";
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
});

/** Add a preventive plan; its next due is worked out from its interval and the machine's meter. */
export const POST = maintenanceRoute(async (session, request) => {
  const input = await readBody(request, body);
  return createPlan(prisma, { companyId: session.user.companyId, userId: session.user.id, ...input, lastDoneAt: input.lastDoneAt ? new Date(input.lastDoneAt) : null });
});
