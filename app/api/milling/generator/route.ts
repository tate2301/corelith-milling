import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { recordGeneratorRun } from "@/lib/milling/maintenance/equipment";
import { prisma } from "@/lib/prisma";

export const GET = millRoute(null, async ({ companyId }) => {
  const rows = await prisma.millingGeneratorRun.findMany({ where: { companyId }, orderBy: { startedAt: "desc" }, take: 300 });
  return rows.map((row) => ({ ...row, hours: Math.round(((row.endedAt.getTime() - row.startedAt.getTime()) / 3_600_000) * 100) / 100, litres: Number(row.litres) }));
});

const num = z.preprocess((value) => (value === "" || value === undefined ? null : value), z.coerce.number().nullable().optional());
const body = z.object({
  equipmentId: z.string().uuid().nullable().optional(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  litres: z.coerce.number().min(0),
  meterStart: num,
  meterEnd: num,
  reason: z.string().max(500).nullable().optional(),
});

export const POST = millRoute("fuel.record", async ({ companyId, userId }, request) => {
  const input = await readBody(request, body);
  return recordGeneratorRun(prisma, { companyId, userId, ...input, startedAt: new Date(input.startedAt), endedAt: new Date(input.endedAt) });
});
