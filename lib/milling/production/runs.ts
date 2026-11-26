import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";

import { treatmentsOf } from "../books/cost-treatment";
import { millRefusal } from "../errors";
import { nextDailyCode } from "../records/codes";
import { createLot, issueOldestFirst, receiveIntoLot, StockLedgerError } from "../stock/ledger";

/**
 * A production run (Grandmeal spec, Stage 1): one entry turns raw materials
 * into bags of finished stock.
 *
 * - Production records the product (scanned by its barcode or picked), the
 *   bags made, the batch number and the date produced.
 * - The product's recipe is deducted, oldest first: its kilogram input (maize)
 *   per bag, one empty bag per bag, and thread per bag. Fuel is not on the
 *   recipe; it is issued to the mill or the generator as used.
 * - When the maize actually used differs from the recipe, production enters
 *   the actual figure; the difference is kept as yield variance.
 * - The bags land AVAILABLE in the chosen store under the batch number, so they
 *   show at once in the shop and on order lines.
 * - A run will not post if an input would go below zero: it names the short
 *   input, and stores fixes the receipt first. An input with no cost
 *   treatment is refused too, naming it: accounting sets it first.
 * - Bag cost is the inputs whose treatment is cost of sales, at their unit
 *   cost, over the bags.
 */

type Db = PrismaClient;
export const RUN_ENTITY = "MillingProductionRun";
const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const ZERO = D(0);

export interface RunInput {
  companyId: string;
  userId: string;
  productId: string;
  bags: number;
  batchNumber: string;
  producedOn: string;
  stockLocationId: string;
  /** The maize actually used, when it differs from the recipe. */
  actualInputKg?: number | null;
}

/** A product by its barcode or code, for the scanner: one bag product, or none. */
export async function productByBarcode(db: Db, companyId: string, scanned: string) {
  const code = scanned.trim();
  if (!code) return null;
  const found = await db.product.findMany({ where: { companyId, unit: "BAG", archivedAt: null, OR: [{ barcode: code }, { code }] }, select: { id: true, name: true } });
  return found.length === 1 ? found[0]! : null;
}

export async function recordProductionRun(db: Db, args: RunInput) {
  if (!Number.isInteger(args.bags) || args.bags <= 0) throw millRefusal("Enter the bags made.");
  const batchNumber = args.batchNumber.trim().toUpperCase();
  if (!batchNumber) throw millRefusal("Enter the batch number.");
  const producedOn = new Date(`${args.producedOn}T00:00:00Z`);
  if (Number.isNaN(producedOn.getTime())) throw millRefusal("Enter the date produced.");
  if (producedOn.getTime() > Date.now()) throw millRefusal("The date produced is today or earlier.");
  if (args.actualInputKg !== null && args.actualInputKg !== undefined && !(args.actualInputKg >= 0)) throw millRefusal("The maize used is nothing or more.");

  return db.$transaction(async (tx) => {
    const product = await tx.product.findFirst({ where: { id: args.productId, companyId: args.companyId, unit: "BAG" }, select: { id: true, name: true } });
    if (!product) throw millRefusal("Choose a finished product made in bags.");
    const recipe = await tx.millingPackRecipe.findFirst({ where: { companyId: args.companyId, packedProductId: product.id, isActive: true } });
    if (!recipe) throw millRefusal(`${product.name} has no recipe. Set it in Settings › Pack recipes.`);
    const store = await tx.stockLocation.findFirst({ where: { id: args.stockLocationId, site: { companyId: args.companyId }, isActive: true }, select: { id: true, siteId: true } });
    if (!store) throw millRefusal("Choose the store the bags go into.");
    if (await tx.millingLot.findFirst({ where: { companyId: args.companyId, code: batchNumber }, select: { id: true } })) {
      throw millRefusal(`Batch ${batchNumber} is already recorded. Each run has its own batch number.`);
    }

    const thread = recipe.threadPerBag ? await tx.product.findFirst({ where: { companyId: args.companyId, code: "THREAD" }, select: { id: true } }) : null;
    const recipeKg = recipe.kgPerBag.times(args.bags);
    const actualKg = args.actualInputKg === null || args.actualInputKg === undefined ? recipeKg : D(args.actualInputKg);
    const inputs: Array<{ productId: string; quantity: Prisma.Decimal }> = [{ productId: recipe.bulkProductId, quantity: actualKg }];
    if (recipe.bagProductId) inputs.push({ productId: recipe.bagProductId, quantity: D(args.bags) });
    if (thread && recipe.threadPerBag) inputs.push({ productId: thread.id, quantity: recipe.threadPerBag.times(args.bags) });

    const items = await tx.product.findMany({ where: { id: { in: inputs.map((input) => input.productId) } }, select: { id: true, name: true } });
    const name = (id: string) => items.find((item) => item.id === id)?.name ?? "an input";
    const treatments = await treatmentsOf(tx, args.companyId, inputs.map((input) => input.productId));
    const untreated = inputs.filter((input) => !treatments.has(input.productId));
    if (untreated.length) throw millRefusal(`Accounting sets the cost treatment of ${untreated.map((input) => name(input.productId)).join(", ")} before a run uses it.`);

    const code = await nextDailyCode(tx, "millingProductionRun", args.companyId, "PR");
    const runId = randomUUID();
    const source = { companyId: args.companyId, userId: args.userId, sourceType: RUN_ENTITY, sourceId: runId, reference: `${code} · ${batchNumber}` };
    for (const input of inputs) {
      try {
        await issueOldestFirst(tx, { ...source, productId: input.productId, quantity: input.quantity, reason: "PRODUCTION_ISSUE", label: name(input.productId) });
      } catch (error) {
        if (error instanceof StockLedgerError) throw millRefusal(`${error.message} Stores fixes the receipt first.`);
        throw error;
      }
    }

    // Bag cost: the cost-of-sales inputs at their unit cost at this site.
    const costs = await tx.inventoryItem.findMany({ where: { siteId: store.siteId, productId: { in: inputs.map((input) => input.productId) } }, select: { productId: true, unitCost: true } });
    const costed = inputs.filter((input) => treatments.get(input.productId) === "COST_OF_SALES");
    const priced = costed.every((input) => costs.some((row) => row.productId === input.productId && row.unitCost !== null));
    const total = costed.reduce((sum, input) => sum.plus(input.quantity.times(costs.find((row) => row.productId === input.productId)?.unitCost ?? ZERO)), ZERO);
    const bagCost = priced ? total.dividedBy(args.bags).toDecimalPlaces(4) : null;

    const lot = await createLot(tx, {
      companyId: args.companyId,
      code: batchNumber,
      productId: product.id,
      status: "AVAILABLE",
      originType: "RUN",
      originId: runId,
      producedAt: producedOn,
      attributes: { run: code, ...(bagCost ? { bagCost: bagCost.toString() } : {}) },
    });
    await receiveIntoLot(tx, { ...source, lotId: lot.id, stockLocationId: store.id, quantity: args.bags, reason: "PRODUCTION_OUTPUT" });

    const run = await tx.millingProductionRun.create({
      data: {
        id: runId,
        companyId: args.companyId,
        code,
        productId: product.id,
        recipeId: recipe.id,
        bags: args.bags,
        batchNumber,
        producedOn,
        outputLotId: lot.id,
        stockLocationId: store.id,
        recipeInputKg: recipeKg,
        actualInputKg: actualKg,
        yieldVarianceKg: actualKg.minus(recipeKg),
        bagCost,
        recordedById: args.userId,
      },
    });
    await writePlatformAuditEvent(
      {
        companyId: args.companyId,
        actorId: args.userId,
        eventType: "milling.production-run.recorded",
        entityType: RUN_ENTITY,
        entityId: run.id,
        payload: { code, product: product.name, bags: args.bags, batchNumber, producedOn: args.producedOn, recipeKg: recipeKg.toString(), actualKg: actualKg.toString() },
      },
      tx,
    );
    return run;
  });
}
