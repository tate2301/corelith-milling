import { millRoute } from "@/lib/milling/api";
import { surveyByRoute } from "@/lib/milling/customers/customers";
import { prisma } from "@/lib/prisma";

/** The market survey by route (R9), for a range of days; this month by default. */
export const GET = millRoute(null, async ({ companyId }, request) => {
  const params = new URL(request.url).searchParams;
  const now = new Date();
  const from = params.get("from") ? new Date(`${params.get("from")}T00:00:00.000Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = params.get("to") ? new Date(`${params.get("to")}T00:00:00.000Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), rows: await surveyByRoute(prisma, companyId, { from, to }) };
});
