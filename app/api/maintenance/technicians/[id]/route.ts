import { z } from "zod";

import { maintenanceRoute, readBody } from "@/lib/maintenance/api";
import { PlanRefused } from "@/lib/maintenance/plans";
import { prisma } from "@/lib/prisma";

const body = z.object({ trade: z.string().trim().max(80).nullable().optional(), hourlyRate: z.number().min(0).nullable().optional(), isActive: z.boolean().optional() });

/** Change a technician's trade or rate, or say they no longer work here. */
export const PATCH = maintenanceRoute<{ id: string }>(async (session, request, { id }) => {
  const input = await readBody(request, body);
  const technician = await prisma.maintenanceTechnician.findFirst({ where: { id, companyId: session.user.companyId } });
  if (!technician) throw new PlanRefused("That technician is not in this workspace.");
  return prisma.maintenanceTechnician.update({ where: { id }, data: input });
});
