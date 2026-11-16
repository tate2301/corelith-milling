import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { startBatch } from "@/lib/milling/production/batches";
import { prisma } from "@/lib/prisma";

export const GET = millRoute(null, async ({ companyId }, request) => {
  const status = new URL(request.url).searchParams.get("status");
  const rows = await prisma.millingBatch.findMany({
    where: { companyId, ...(status === "ACTIVE" ? { status: { in: ["OPEN", "IN_PROGRESS", "AWAITING_DECISION"] } } : status ? { status } : {}) },
    orderBy: { startedAt: "desc" },
    take: 200,
    include: { stages: { select: { stageCode: true } }, outputs: { select: { quantityKg: true } } },
  });
  return rows.map((row) => ({ ...row, stagesDone: row.stages.length, outputKg: row.outputs.reduce((sum, output) => sum + Number(output.quantityKg), 0), stages: undefined, outputs: undefined }));
});

const body = z.object({ orderId: z.string().uuid().nullable().optional(), shiftId: z.string().uuid().nullable().optional() });

export const POST = millRoute("batch.run", async ({ companyId, userId }, request) => startBatch(prisma, { companyId, userId, ...(await readBody(request, body)) }));
