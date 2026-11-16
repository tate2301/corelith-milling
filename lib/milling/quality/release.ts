import type { Prisma } from "@prisma/client";

import { assertNotBlocked } from "../exceptions/exceptions";
import { latestInspection, QcError } from "./inspect";

type Tx = Prisma.TransactionClient;

/**
 * May this record's stock be released for use? Only when its latest
 * inspection passed, or when someone allowed to decide has released it anyway
 * since that inspection, and nothing on it still waits for a decision.
 */
export async function assertReleasable(tx: Tx, target: { companyId: string; targetType: string; targetId: string }) {
  await assertNotBlocked(tx, target);
  const inspection = await latestInspection(tx, target);
  if (!inspection) throw new QcError("Inspect it first: nothing is released without QC.");
  if (inspection.outcome === "PASS") return { inspection, overridden: false };
  const override = await tx.millingException.findFirst({
    where: {
      ...target,
      status: "DECIDED",
      type: { in: ["QC_FAIL", "QC_NOT_PERFORMED"] },
      decision: "RELEASE_ANYWAY",
      createdAt: { gte: inspection.inspectedAt },
    },
    orderBy: { decidedAt: "desc" },
  });
  if (!override) {
    throw new QcError(
      inspection.outcome === "FAIL"
        ? "The last inspection failed. Re-inspect, or have management release it anyway."
        : "A required check was not performed. Re-inspect, or have management release it anyway.",
    );
  }
  return { inspection, overridden: true };
}
