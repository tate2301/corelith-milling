import { millRoute, readBody } from "@/lib/milling/api";
import { idsBody } from "@/lib/milling/reports/approve-ids";
import { decideMany } from "@/lib/milling/reports/decide-many";
import { millRefusal } from "@/lib/milling/errors";
import { prisma } from "@/lib/prisma";

/** Approve the ticked plans and shifts on Waiting for you; each goes through its own checks and answers for itself. */
export const POST = millRoute(null, async ({ companyId, userId, access }, request) => {
  const { ids } = await readBody(request, idsBody);
  const plans = await prisma.millingProductionOrder.findMany({ where: { companyId, id: { in: ids } }, select: { id: true } });
  const planIds = new Set(plans.map((row) => row.id));
  const results = await decideMany(prisma, { companyId, userId, access, action: "approve", items: ids.map((id) => ({ kind: planIds.has(id) ? ("plan" as const) : ("shift" as const), id })) });
  if (!results.some((row) => row.ok)) throw millRefusal(results.map((row) => row.message).join(" ") || "Nothing was approved.");
  return { results };
});
