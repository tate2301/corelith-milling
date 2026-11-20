import { millRoute } from "@/lib/milling/api";
import { millDashboard } from "@/lib/milling/reports/dashboard";
import { waitingFor, yesterdayBySite } from "@/lib/milling/reports/home";
import { prisma } from "@/lib/prisma";

/** The Overview: what waits for this person (HM-A1), yesterday by site, then the mill now. */
export const GET = millRoute(null, async ({ companyId, access }) => {
  const [now, waiting, yesterday] = await Promise.all([millDashboard(prisma, companyId), waitingFor(prisma, companyId, access), yesterdayBySite(prisma, companyId)]);
  return { ...now, waiting, yesterday };
});
