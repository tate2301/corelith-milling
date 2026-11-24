import { idsBody, maintenanceRoute, readBody } from "@/lib/maintenance/api";
import { prisma } from "@/lib/prisma";

/** Start the ticked open work orders. */
export const POST = maintenanceRoute(async (session, request) => {
  const { ids } = await readBody(request, idsBody);
  const { count } = await prisma.workOrder.updateMany({ where: { id: { in: ids }, companyId: session.user.companyId, status: "OPEN" }, data: { status: "IN_PROGRESS" } });
  return { started: count };
});
