import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { createOrder } from "@/lib/milling/production/orders";
import { prisma } from "@/lib/prisma";

export const GET = millRoute(null, async ({ companyId }, request) => {
  const status = new URL(request.url).searchParams.get("status");
  const rows = await prisma.millingProductionOrder.findMany({
    where: { companyId, ...(status ? { status } : {}) },
    orderBy: [{ productionDate: "desc" }, { code: "desc" }],
    take: 200,
    include: { lines: true },
  });
  const counts = await prisma.millingProductionOrder.groupBy({ by: ["status"], where: { companyId }, _count: { _all: true } });
  return { rows, counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])) };
});

const body = z.object({
  productionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the day."),
  shiftKind: z.enum(["DAY", "NIGHT"]),
  supervisorId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(z.object({ productId: z.string().uuid(), bags: z.coerce.number().int().positive().nullable().optional(), kg: z.coerce.number().positive().nullable().optional() })).min(1, "Add at least one product."),
});

export const POST = millRoute("plan.edit", async ({ companyId, userId }, request) => createOrder(prisma, { companyId, userId, ...(await readBody(request, body)) }));
