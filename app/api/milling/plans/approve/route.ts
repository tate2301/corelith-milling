import { millRoute, readBody } from "@/lib/milling/api";
import { answerFor, idsBody } from "@/lib/milling/reports/approve-ids";
import { decideMany } from "@/lib/milling/reports/decide-many";
import { prisma } from "@/lib/prisma";

/** Approve the ticked plans from the Plans list; each goes through its own checks. */
export const POST = millRoute("plan.approve", async ({ companyId, userId, access }, request) => {
  const { ids } = await readBody(request, idsBody);
  return answerFor("plan", await decideMany(prisma, { companyId, userId, access, action: "approve", items: ids.map((id) => ({ kind: "plan" as const, id })) }));
});
