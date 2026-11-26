import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { voidVoucher } from "@/lib/milling/customers/vouchers";
import { prisma } from "@/lib/prisma";

const body = z.object({ reason: z.string().trim().min(3, "Say why the voucher is void.").max(500) });

/** Accounting voids a voucher that was issued in error. */
export const POST = millRoute<{ id: string }>("order.assign", async ({ companyId, userId }, request, { id }) => voidVoucher(prisma, { companyId, userId, voucherId: id, ...(await readBody(request, body)) }));
