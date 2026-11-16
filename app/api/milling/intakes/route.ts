import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { recordIntake } from "@/lib/milling/intake/intake";
import { prisma } from "@/lib/prisma";

const STATUSES = ["AWAITING_QC", "HELD", "ACCEPTED", "REJECTED", "CANCELLED"] as const;

/** Deliveries, newest first, by status: `?status=AWAITING_QC`. */
export const GET = millRoute(null, async ({ companyId }, request) => {
  const status = new URL(request.url).searchParams.get("status");
  const where = { companyId, ...(status && (STATUSES as readonly string[]).includes(status) ? { status } : {}) };
  const [rows, counts] = await Promise.all([
    prisma.millingIntake.findMany({ where, orderBy: { receivedAt: "desc" }, take: 200 }),
    prisma.millingIntake.groupBy({ by: ["status"], where: { companyId }, _count: { _all: true } }),
  ]);
  return {
    rows: rows.map((row) => ({ ...row, netKg: Number(row.netKg) })),
    counts: Object.fromEntries(counts.map((count) => [count.status, count._count._all])),
  };
});

const optionalNumber = z.preprocess((value) => (value === "" || value === null ? undefined : value), z.coerce.number().optional());
const optionalText = z.preprocess((value) => (value === "" ? null : value), z.string().trim().max(200).nullable().optional());

const body = z.object({
  productId: z.string().uuid(),
  supplierId: z.string().uuid().nullable().optional(),
  supplierName: z.string().trim().min(1, "Who delivered it?").max(200),
  deliveryRef: optionalText,
  vehicleReg: optionalText,
  driverName: optionalText,
  variety: optionalText,
  weighMethod: z.enum(["BAG_COUNT", "EXTERNAL_TICKET", "SUPPLIER_DECLARED"]),
  bags: optionalNumber,
  bagKg: optionalNumber,
  grossKg: optionalNumber,
  tareKg: optionalNumber,
  netKg: optionalNumber,
  ticketNumber: optionalText,
  ticketFileUrl: optionalText,
  binLocationId: z.string().uuid().nullable().optional(),
  notes: z.preprocess((value) => (value === "" ? null : value), z.string().max(2000).nullable().optional()),
});

export const POST = millRoute("intake.record", async ({ companyId, userId }, request) =>
  recordIntake(prisma, { companyId, userId, input: await readBody(request, body) }),
);
