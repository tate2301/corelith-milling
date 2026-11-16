import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse } from "@/lib/api-response";
import { can } from "@/lib/milling/access/groups";
import { millRoute, readBody } from "@/lib/milling/api";
import { completeBatch, issueMaize, recordOutput, recordStage } from "@/lib/milling/production/batches";
import { prisma } from "@/lib/prisma";
import { notifyMill } from "@/lib/milling/notify";

const num = z.preprocess((value) => (value === "" || value === undefined ? null : value), z.coerce.number().nullable().optional());

const schemas = {
  issue: z.object({ lotId: z.string().uuid(), stockLocationId: z.string().uuid(), quantityKg: z.coerce.number().positive("Issue more than nothing.") }),
  stage: z.object({
    stageId: z.string().uuid(),
    shiftId: z.string().uuid().nullable().optional(),
    equipmentCodes: z.array(z.string()).optional(),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().nullable().optional(),
    inputKg: num,
    inputEstimated: z.boolean().optional(),
    removedKg: num,
    removedEstimated: z.boolean().optional(),
    waterLitres: num,
    moistureBeforePct: num,
    moistureAfterPct: num,
    observations: z.string().max(2000).nullable().optional(),
    abnormal: z.boolean().optional(),
  }),
  output: z.object({ productId: z.string().uuid(), stockLocationId: z.string().uuid(), quantityKg: z.coerce.number().positive("Record more than nothing."), isEstimated: z.boolean().optional() }),
  complete: z.object({ inProcessChangeKg: num }),
};

/** issue (maize in) · stage · output · complete */
export const POST = millRoute<{ id: string; action: string }>(null, async ({ companyId, userId, access }, request, { id, action }) => {
  const base = { companyId, userId, batchId: id };
  const refuse = () => errorResponse("Your groups at the mill do not allow this.", 403) as NextResponse;
  switch (action) {
    case "issue":
      if (!can(access, "batch.run")) return refuse();
      return issueMaize(prisma, { ...base, ...(await readBody(request, schemas.issue)) });
    case "stage":
      if (!can(access, "stage.record")) return refuse();
      return recordStage(prisma, { ...base, input: await readBody(request, schemas.stage) });
    case "output":
      if (!can(access, "stage.record")) return refuse();
      return recordOutput(prisma, { ...base, ...(await readBody(request, schemas.output)) });
    case "complete": {
      if (!can(access, "batch.approve")) return refuse();
      const input = await readBody(request, schemas.complete);
      const batch = await completeBatch(prisma, { ...base, inProcessChangeKg: input.inProcessChangeKg ?? null });
      if (batch.status === "COMPLETED") {
        await notifyMill(prisma, { companyId, to: "qc.record", actorId: userId, title: `Product to inspect: ${batch.code}`, summary: "Its bulk product is on hold until QC releases it.", viewPath: "/milling/quality", entityId: batch.id });
      }
      return batch;
    }
    default:
      return errorResponse("No such action.", 404) as NextResponse;
  }
});
