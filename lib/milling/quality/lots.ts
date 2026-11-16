import type { Prisma, PrismaClient } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";

import { millRefusal } from "../errors";
import { issueFromLot, setLotStatus } from "../stock/ledger";
import { recordInspection, type QcResultInput } from "./inspect";
import { assertReleasable } from "./release";

/**
 * Product inspection (plan 4.6, stage 9): bulk product from a batch waits on
 * hold until the quality officer inspects it and releases it. Rejected
 * product is disposed of.
 */

export const LOT_ENTITY = "MillingLot";

export async function inspectLot(db: PrismaClient, args: { companyId: string; userId: string; lotId: string; results: QcResultInput[]; notes?: string | null }) {
  return db.$transaction(async (tx) => {
    const lot = await tx.millingLot.findFirst({ where: { id: args.lotId, companyId: args.companyId } });
    if (!lot) throw millRefusal("That lot is not at the mill.");
    if (!["HOLD", "AVAILABLE"].includes(lot.status)) throw millRefusal(`Lot ${lot.code} is ${lot.status.toLowerCase()}.`);
    return recordInspection(tx, {
      companyId: args.companyId,
      userId: args.userId,
      point: lot.originType === "INTAKE" ? "INCOMING_MAIZE" : "FINISHED_PRODUCT",
      targetType: LOT_ENTITY,
      targetId: lot.id,
      targetLabel: `Lot ${lot.code}`,
      results: args.results,
      notes: args.notes,
    });
  });
}

export type DecideLotArgs = { companyId: string; userId: string; lotId: string; decision: "RELEASE" | "HOLD" | "REJECT"; note?: string | null };

const DONE = { RELEASE: "released", HOLD: "held", REJECT: "rejected" } as const;

export async function decideLot(db: PrismaClient, args: DecideLotArgs) {
  return db.$transaction((tx) => decideLotIn(tx, args));
}

/** The decision inside a caller's transaction: an exception's REJECT applies it with its own. */
export async function decideLotIn(tx: Prisma.TransactionClient, args: DecideLotArgs) {
  {
    const lot = await tx.millingLot.findFirst({ where: { id: args.lotId, companyId: args.companyId }, include: { balances: true } });
    if (!lot) throw millRefusal("That lot is not at the mill.");
    if (lot.status === "CONSUMED" || lot.status === "REJECTED") throw millRefusal(`Lot ${lot.code} is ${lot.status.toLowerCase()}.`);
    if (args.decision === "RELEASE") {
      await assertReleasable(tx, { companyId: args.companyId, targetType: LOT_ENTITY, targetId: lot.id });
      await setLotStatus(tx, { companyId: args.companyId, lotId: lot.id, status: "AVAILABLE" });
    } else if (args.decision === "HOLD") {
      await setLotStatus(tx, { companyId: args.companyId, lotId: lot.id, status: "HOLD" });
    } else {
      if ((args.note ?? "").trim().length < 3) throw millRefusal("Say why the lot is rejected.");
      for (const balance of lot.balances.filter((row) => row.quantity.gt(0))) {
        if (balance.reserved.gt(0)) throw millRefusal(`Lot ${lot.code} is promised; release the reservation first.`);
        await issueFromLot(tx, {
          companyId: args.companyId,
          userId: args.userId,
          lotId: lot.id,
          stockLocationId: balance.stockLocationId,
          quantity: balance.quantity,
          reason: "QC_DISPOSAL",
          sourceType: LOT_ENTITY,
          sourceId: lot.id,
          reference: lot.code,
        });
      }
      await tx.millingLot.update({ where: { id: lot.id }, data: { status: "REJECTED" } });
    }
    await writePlatformAuditEvent(
      { companyId: args.companyId, actorId: args.userId, eventType: `milling.lot.${DONE[args.decision]}`, entityType: LOT_ENTITY, entityId: lot.id, reason: args.note ?? undefined },
      tx,
    );
    return tx.millingLot.findUniqueOrThrow({ where: { id: lot.id } });
  }
}
