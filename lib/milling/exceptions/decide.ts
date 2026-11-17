import type { PrismaClient } from "@prisma/client";

import { decideIntakeIn, INTAKE_ENTITY } from "../intake/intake";
import { BATCH_ENTITY, settleVarianceIn } from "../production/batches";
import { decideLotIn, LOT_ENTITY } from "../quality/lots";
import { COUNT_ENTITY, settleCountIn } from "../stock/counts";
import { decideException } from "./exceptions";

/**
 * Decide an exception and carry out what the decision means for its record,
 * in one transaction: a discarded count is discarded, a rejected delivery is
 * rejected. A decision that only lifts a block (release anyway, keep on hold)
 * changes nothing else; the person who owns the record takes the next step.
 */
export async function decideAndApply(
  db: PrismaClient,
  args: { companyId: string; deciderId: string; exceptionId: string; decision: string; note: string },
) {
  return db.$transaction(async (tx) => {
    const exception = await decideException(tx, args);
    const base = { companyId: args.companyId, userId: args.deciderId };
    if (exception.targetType === COUNT_ENTITY) {
      await settleCountIn(tx, { ...base, countId: exception.targetId, post: exception.decision === "POST_COUNT" });
    }
    if (exception.targetType === INTAKE_ENTITY && exception.decision === "REJECT") {
      const intake = await tx.millingIntake.findFirst({ where: { id: exception.targetId, companyId: args.companyId }, select: { status: true } });
      if (intake && ["AWAITING_QC", "HELD"].includes(intake.status)) {
        await decideIntakeIn(tx, { ...base, intakeId: exception.targetId, decision: "REJECT", note: args.note });
      }
    }
    if (exception.targetType === BATCH_ENTITY) {
      await settleVarianceIn(tx, { companyId: args.companyId, batchId: exception.targetId, decision: exception.decision ?? "" });
    }
    if (exception.targetType === LOT_ENTITY && exception.decision === "REJECT") {
      const lot = await tx.millingLot.findFirst({ where: { id: exception.targetId, companyId: args.companyId }, select: { status: true } });
      if (lot && ["HOLD", "AVAILABLE"].includes(lot.status)) {
        await decideLotIn(tx, { ...base, lotId: exception.targetId, decision: "REJECT", note: args.note });
      }
    }
    return exception;
  });
}
