import { z } from "zod";

import { maintenanceRoute, readBody } from "@/lib/maintenance/api";
import { raiseService } from "@/lib/maintenance/plans";
import { prisma } from "@/lib/prisma";

const body = z.object({ scheduledFor: z.string().regex(/^\d{4}-\d{2}-\d{2}/).nullable().optional() });

/** Book a plan's service as a work order, for a day or for when it is due. */
export const POST = maintenanceRoute<{ id: string }>(async (session, request, { id }) => {
  const { scheduledFor } = await readBody(request, body);
  return raiseService(prisma, { companyId: session.user.companyId, userId: session.user.id, planId: id, scheduledFor: scheduledFor ? new Date(`${scheduledFor.slice(0, 10)}T08:00:00`) : null });
});
