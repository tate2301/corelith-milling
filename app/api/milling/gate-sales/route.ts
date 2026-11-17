import { millRoute } from "@/lib/milling/api";
import { matchGateSales } from "@/lib/milling/distribution/gate-sales";
import { prisma } from "@/lib/prisma";

/** Match the gate till's sales to the mill's lots. Safe to run any time. */
export const POST = millRoute("stock.move", async ({ companyId, userId }) => matchGateSales(prisma, { companyId, userId }));
