import { millRoute } from "@/lib/milling/api";
import { directorDay } from "@/lib/milling/reports/director";
import { prisma } from "@/lib/prisma";

/** Yesterday across the sites, for the director's phone (HM-B1). */
export const GET = millRoute(null, async ({ companyId }) => directorDay(prisma, companyId));
