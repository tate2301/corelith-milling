import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { createCustomerOrder } from "@/lib/milling/distribution/customer-orders";
import { prisma } from "@/lib/prisma";

/** Customer orders by status, with customer, destination and bag totals. */
export const GET = millRoute(null, async ({ companyId }, request) => {
  const status = new URL(request.url).searchParams.get("status");
  const rows = await prisma.millingCustomerOrder.findMany({
    where: { companyId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { lines: true },
  });
  const [customers, destinations, products, counts] = await Promise.all([
    prisma.customer.findMany({ where: { companyId, id: { in: rows.map((row) => row.customerId) } }, select: { id: true, name: true } }),
    prisma.millingDestination.findMany({ where: { companyId } }),
    prisma.product.findMany({ where: { companyId, id: { in: rows.flatMap((row) => row.lines.map((line) => line.productId)) } }, select: { id: true, name: true, netWeightKg: true } }),
    prisma.millingCustomerOrder.groupBy({ by: ["status"], where: { companyId }, _count: { _all: true } }),
  ]);
  return {
    counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
    rows: rows.map((row) => ({
      ...row,
      customer: customers.find((customer) => customer.id === row.customerId)?.name ?? "",
      destination: destinations.find((destination) => destination.id === row.destinationId)?.name ?? null,
      bags: row.lines.reduce((sum, line) => sum + line.bags, 0),
      kg: row.lines.reduce((sum, line) => sum + line.bags * Number(products.find((product) => product.id === line.productId)?.netWeightKg ?? 0), 0),
      lines: row.lines.map((line) => ({ ...line, product: products.find((product) => product.id === line.productId)?.name ?? "" })),
      invoiceId: row.invoiceId,
    })),
  };
});

const body = z.object({
  customerId: z.string().uuid("Choose the customer."),
  destinationId: z.string().uuid().nullable().optional(),
  requiredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(z.object({ productId: z.string().uuid(), bags: z.coerce.number().int().positive(), unitPrice: z.coerce.number().min(0).nullable().optional() })).min(1, "Add at least one product."),
});

export const POST = millRoute("order.manage", async ({ companyId, userId }, request) => createCustomerOrder(prisma, { companyId, userId, ...(await readBody(request, body)) }));
