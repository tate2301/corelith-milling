import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { isLive, issueVoucher, VOUCHER_KINDS } from "@/lib/milling/customers/vouchers";
import { prisma } from "@/lib/prisma";

/** A customer's vouchers, newest first, each with whether it is live: `?customerId=`. */
export const GET = millRoute(null, async ({ companyId }, request) => {
  const customerId = new URL(request.url).searchParams.get("customerId");
  const rows = await prisma.millingVoucher.findMany({ where: { companyId, ...(customerId ? { customerId } : {}) }, orderBy: { issuedAt: "desc" }, take: 200 });
  return { rows: rows.map((row) => ({ ...row, live: isLive(row) })) };
});

const body = z.object({
  customerId: z.string().uuid("Choose the customer."),
  kind: z.enum(VOUCHER_KINDS),
  value: z.coerce.number().positive("A voucher takes something off."),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date it expires."),
  useLimit: z.coerce.number().int().min(1).default(1),
});

/** A rep issues a customer's voucher: one live voucher a customer. */
export const POST = millRoute("voucher.issue", async ({ companyId, userId }, request) => issueVoucher(prisma, { companyId, userId, ...(await readBody(request, body)) }));
