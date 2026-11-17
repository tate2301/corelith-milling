import { Prisma } from "@prisma/client";
import { z } from "zod";

import { millRefusal, millRoute, readBody } from "@/lib/milling/api";
import { requirementsFor } from "@/lib/milling/production/orders";
import { prisma } from "@/lib/prisma";

const body = z.object({ lines: z.array(z.object({ productId: z.string().uuid(), bags: z.coerce.number().int().positive().nullable().optional(), kg: z.coerce.number().positive().nullable().optional() })) });

/** Live material needs for a plan being written: maize, bags and thread against what is free. */
export const POST = millRoute(null, async ({ companyId }, request) => {
  const { lines } = await readBody(request, body);
  const products = await prisma.product.findMany({ where: { companyId, id: { in: lines.map((line) => line.productId) } }, select: { id: true, unit: true, netWeightKg: true } });
  const resolved = lines.flatMap((line): Array<{ productId: string; bags: number | null; kg: Prisma.Decimal }> => {
    const product = products.find((entry) => entry.id === line.productId);
    if (!product) throw millRefusal("A line names a product that is not in this workspace.");
    if (product.unit === "BAG") return line.bags && product.netWeightKg ? [{ productId: line.productId, bags: line.bags, kg: product.netWeightKg.times(line.bags) }] : [];
    return line.kg ? [{ productId: line.productId, bags: null, kg: new Prisma.Decimal(line.kg) }] : [];
  });
  const needs = await requirementsFor(prisma, companyId, resolved);
  return {
    outputKg: Number(needs.outputKg),
    maizeKg: Number(needs.maizeKg),
    maizeAvailableKg: Number(needs.maizeAvailableKg),
    packaging: needs.packaging.map((row) => ({ ...row, needed: Number(row.needed), available: Number(row.available) })),
    short: needs.short,
  };
});
