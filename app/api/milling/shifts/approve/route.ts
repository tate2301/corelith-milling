import { millRoute, readBody } from "@/lib/milling/api";
import { answerFor, idsBody } from "@/lib/milling/reports/approve-ids";
import { decideMany } from "@/lib/milling/reports/decide-many";
import { prisma } from "@/lib/prisma";

/** Approve the ticked closed shifts from the Shifts list; approval writes their attendance. */
export const POST = millRoute("shift.approve", async ({ companyId, userId, access }, request) => {
  const { ids } = await readBody(request, idsBody);
  return answerFor("shift", await decideMany(prisma, { companyId, userId, access, action: "approve", items: ids.map((id) => ({ kind: "shift" as const, id })) }));
});
