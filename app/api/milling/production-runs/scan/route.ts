import { millRoute } from "@/lib/milling/api";
import { productByBarcode } from "@/lib/milling/production/runs";
import { prisma } from "@/lib/prisma";

/** The finished product a scanned barcode (or code) names, and its recipe's kilograms a bag: `?code=`. */
export const GET = millRoute(null, async ({ companyId }, request) => {
  const product = await productByBarcode(prisma, companyId, new URL(request.url).searchParams.get("code") ?? "");
  if (!product) return { product: null };
  const recipe = await prisma.millingPackRecipe.findFirst({ where: { companyId, packedProductId: product.id, isActive: true }, select: { kgPerBag: true } });
  return { product: { ...product, kgPerBag: recipe ? Number(recipe.kgPerBag) : null } };
});
