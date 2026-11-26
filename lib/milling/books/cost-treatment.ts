import type { Prisma, PrismaClient } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";

import { millRefusal } from "../errors";

/**
 * Cost treatment (Grandmeal spec, Workspace setup): where an item's cost lands
 * in profit and loss. Every raw material, packaging item and consumable
 * carries one, and only accounting sets or changes it.
 *
 *   COST_OF_SALES      rolled into the cost of each bag; reduces gross profit
 *   OPERATING_EXPENSE  below gross profit; reduces net profit
 *   ASSET              on the balance sheet until used
 *
 * Fuel takes its treatment from the machine it is issued to: a truck is a
 * distribution expense; the mill and the generator are cost of sales.
 */

type Db = PrismaClient | Prisma.TransactionClient;
export const COST_TREATMENTS = ["COST_OF_SALES", "OPERATING_EXPENSE", "ASSET"] as const;
export type CostTreatment = (typeof COST_TREATMENTS)[number];
export const COST_TREATMENT_WORDS: Record<CostTreatment, string> = {
  COST_OF_SALES: "Cost of sales",
  OPERATING_EXPENSE: "Operating expense",
  ASSET: "Asset",
};

/** The items that need a treatment: everything the mill buys or uses, not the bags it sells. */
export const needsTreatment = (product: { unit: string; kind: string }) => product.unit !== "BAG" || product.kind !== "GOODS";

/** Fuel issued to a machine: the machine sets the treatment. */
export function fuelTreatment(equipment: { kind?: string | null; category: string }): CostTreatment {
  return equipment.kind === "VEHICLE" || equipment.category.toUpperCase() === "VEHICLE" ? "OPERATING_EXPENSE" : "COST_OF_SALES";
}

export async function setCostTreatment(db: PrismaClient, args: { companyId: string; userId: string; mayCost: boolean; productId: string; treatment: CostTreatment }) {
  if (!args.mayCost) throw millRefusal("Only accounting sets cost treatments.");
  if (!COST_TREATMENTS.includes(args.treatment)) throw millRefusal("Choose cost of sales, operating expense or asset.");
  return db.$transaction(async (tx) => {
    const product = await tx.product.findFirst({ where: { id: args.productId, companyId: args.companyId }, select: { id: true, name: true, unit: true, kind: true } });
    if (!product) throw millRefusal("That item is not in this workspace.");
    if (!needsTreatment(product)) throw millRefusal(`${product.name} is a finished bag; its cost is its inputs.`);
    const before = await tx.millingCostTreatment.findUnique({ where: { productId: product.id } });
    const row = await tx.millingCostTreatment.upsert({
      where: { productId: product.id },
      create: { companyId: args.companyId, productId: product.id, treatment: args.treatment, setById: args.userId },
      update: { treatment: args.treatment, setById: args.userId, setAt: new Date() },
    });
    await writePlatformAuditEvent(
      { companyId: args.companyId, actorId: args.userId, eventType: "milling.cost-treatment.set", entityType: "Product", entityId: product.id, payload: { product: product.name, from: before?.treatment ?? null, to: args.treatment } },
      tx,
    );
    return row;
  });
}

/** Each product's treatment; a missing one refuses the run that would use it, naming it. */
export async function treatmentsOf(db: Db, companyId: string, productIds: string[]) {
  const rows = await db.millingCostTreatment.findMany({ where: { companyId, productId: { in: productIds } } });
  return new Map(rows.map((row) => [row.productId, row.treatment as CostTreatment]));
}
