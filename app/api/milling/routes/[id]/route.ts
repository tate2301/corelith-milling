import { millRefusal, millRoute, readBody } from "@/lib/milling/api";
import { routeBody } from "@/lib/milling/distribution/route-body";
import { routeDetail, saveRoute } from "@/lib/milling/distribution/trips";
import { prisma } from "@/lib/prisma";

export const GET = millRoute<{ id: string }>(null, async ({ companyId }, _request, { id }) => {
  const route = await routeDetail(prisma, companyId, id);
  if (!route) throw millRefusal("That route is not in this workspace.");
  return route;
});

export const POST = millRoute<{ id: string }>("delivery.manage", async ({ companyId }, request, { id }) => saveRoute(prisma, companyId, { id, ...(await readBody(request, routeBody)) }));
