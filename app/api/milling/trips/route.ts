import { millRoute } from "@/lib/milling/api";
import { listTrips } from "@/lib/milling/distribution/trips";
import { prisma } from "@/lib/prisma";

/** Trips: deliveries that have left, with kilometres and fuel. */
export const GET = millRoute(null, async ({ companyId }, request) => {
  const params = new URL(request.url).searchParams;
  const status = params.get("status");
  return listTrips(prisma, companyId, { status: status === "OUT" || status === "CLOSED" ? status : null, routeId: params.get("route") });
});
