import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { submitCount } from "@/lib/milling/stock/counts";
import { prisma } from "@/lib/prisma";

export const GET = millRoute(null, async ({ companyId }) => {
  const rows = await prisma.millingStockCount.findMany({ where: { companyId }, orderBy: { countedAt: "desc" }, take: 100, include: { lines: true } });
  const locations = await prisma.stockLocation.findMany({ where: { site: { companyId } }, select: { id: true, code: true, name: true } });
  return rows.map((row) => ({
    ...row,
    location: locations.find((location) => location.id === row.stockLocationId) ?? null,
    lines: row.lines.map((line) => ({ ...line, expected: Number(line.expected), counted: Number(line.counted) })),
  }));
});

const body = z.object({
  stockLocationId: z.string().uuid(),
  lines: z.array(z.object({ lotId: z.string().uuid(), counted: z.coerce.number().min(0) })).max(500),
  notes: z.string().max(2000).nullable().optional(),
});

export const POST = millRoute("stock.count", async ({ companyId, userId }, request) =>
  submitCount(prisma, { companyId, userId, ...(await readBody(request, body)) }),
);
