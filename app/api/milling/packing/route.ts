import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { checkWeightSummary, recordPackRun } from "@/lib/milling/production/packing";
import { prisma } from "@/lib/prisma";

export const GET = millRoute(null, async ({ companyId }) => {
  const runs = await prisma.millingPackRun.findMany({ where: { companyId }, orderBy: { packedAt: "desc" }, take: 200 });
  const recipes = await prisma.millingPackRecipe.findMany({ where: { companyId } });
  const products = await prisma.product.findMany({ where: { companyId, id: { in: recipes.map((recipe) => recipe.packedProductId) } }, select: { id: true, name: true } });
  const lots = await prisma.millingLot.findMany({ where: { id: { in: runs.map((run) => run.bulkLotId) } }, select: { id: true, code: true } });
  return runs.map((run) => {
    const recipe = recipes.find((entry) => entry.id === run.recipeId);
    return {
      ...run,
      product: products.find((product) => product.id === recipe?.packedProductId)?.name ?? "",
      bulkLot: lots.find((lot) => lot.id === run.bulkLotId)?.code ?? "",
      checks: checkWeightSummary(run.checkWeights.map(Number), Number(recipe?.kgPerBag ?? 0)),
    };
  });
});

const body = z.object({
  recipeId: z.string().uuid(),
  bulkLotId: z.string().uuid(),
  bulkLocationId: z.string().uuid(),
  outputLocationId: z.string().uuid(),
  bagsPacked: z.coerce.number().int().positive("Enter the bags packed."),
  damagedBags: z.coerce.number().int().min(0).optional(),
  bulkUsedKg: z.coerce.number().positive("Enter the bulk used."),
  checkWeights: z.array(z.coerce.number().positive()).max(100).optional(),
  shiftId: z.string().uuid().nullable().optional(),
});

export const POST = millRoute("stage.record", async ({ companyId, userId }, request) => recordPackRun(prisma, { companyId, userId, ...(await readBody(request, body)) }));
