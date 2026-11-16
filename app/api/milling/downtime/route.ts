import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { reportDowntime } from "@/lib/milling/maintenance/equipment";
import { prisma } from "@/lib/prisma";

/** Stops, newest first, with the hours each ran (open ones to now). */
export const GET = millRoute(null, async ({ companyId }) => {
  const rows = await prisma.millingDowntime.findMany({ where: { companyId }, orderBy: { startedAt: "desc" }, take: 300 });
  const equipment = await prisma.equipment.findMany({ where: { id: { in: rows.map((row) => row.equipmentId).filter((id): id is string => Boolean(id)) } }, select: { id: true, equipmentCode: true, name: true } });
  const now = Date.now();
  return rows.map((row) => ({
    ...row,
    equipment: equipment.find((entry) => entry.id === row.equipmentId) ?? null,
    hours: Math.round((((row.endedAt?.getTime() ?? now) - row.startedAt.getTime()) / 3_600_000) * 100) / 100,
  }));
});

const body = z.object({
  equipmentId: z.string().uuid().nullable().optional(),
  category: z.enum(["BREAKDOWN", "POWER", "MATERIAL", "PLANNED", "OTHER"]),
  cause: z.string().trim().min(3, "Say what stopped."),
  startedAt: z.string().datetime().optional(),
  batchId: z.string().uuid().nullable().optional(),
  shiftId: z.string().uuid().nullable().optional(),
  stageCode: z.string().max(40).nullable().optional(),
});

export const POST = millRoute("fault.report", async ({ companyId, userId }, request) => {
  const input = await readBody(request, body);
  return reportDowntime(prisma, { companyId, userId, ...input, startedAt: input.startedAt ? new Date(input.startedAt) : undefined });
});
