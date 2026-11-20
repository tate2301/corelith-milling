import { millRoute } from "@/lib/milling/api";
import { retireSeller } from "@/lib/milling/sellers/trips";
import { prisma } from "@/lib/prisma";

/** Stop someone selling: refused while they are out or owe money. */
export const POST = millRoute<{ id: string }>("seller.manage", async ({ companyId, userId }, _request, { id }) => retireSeller(prisma, { companyId, userId, sellerId: id }));
