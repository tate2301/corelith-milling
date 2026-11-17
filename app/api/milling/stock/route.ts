import { millRoute } from "@/lib/milling/api";
import { stockOnHand } from "@/lib/milling/stock/views";
import { prisma } from "@/lib/prisma";

export const GET = millRoute(null, async ({ companyId }) => stockOnHand(prisma, companyId));
