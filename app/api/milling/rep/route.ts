import { millRoute } from "@/lib/milling/api";
import { repDay } from "@/lib/milling/customers/rep";
import { prisma } from "@/lib/prisma";

/** The signed-in rep's route today (HM-C1). */
export const GET = millRoute(null, async ({ companyId, userId }, request) => repDay(prisma, { companyId, userId, routeId: new URL(request.url).searchParams.get("route") }));
