import { maintenanceRoute } from "@/lib/maintenance/api";
import { maintenanceCalendar } from "@/lib/maintenance/overview";
import { prisma } from "@/lib/prisma";

/** A month of services by day (`?month=YYYY-MM`, this month when left out). */
export const GET = maintenanceRoute(async (session, request) => {
  const asked = request.nextUrl.searchParams.get("month");
  const month = asked && /^\d{4}-\d{2}$/.test(asked) ? asked : new Date().toISOString().slice(0, 7);
  return maintenanceCalendar(prisma, session.user.companyId, month);
});
