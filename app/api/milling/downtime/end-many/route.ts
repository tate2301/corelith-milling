import { millRoute, readBody } from "@/lib/milling/api";
import { endDowntime } from "@/lib/milling/maintenance/equipment";
import { idsBody } from "@/lib/milling/reports/approve-ids";
import { prisma } from "@/lib/prisma";

/** End the ticked stops now (a breakdown ends when its machine is released instead). */
export const POST = millRoute("fault.report", async ({ companyId, userId }, request) => {
  const { ids } = await readBody(request, idsBody);
  const ended = [];
  for (const id of ids) ended.push(await endDowntime(prisma, { companyId, userId, downtimeId: id }));
  return { ended: ended.length };
});
