import { millRoute, readBody } from "@/lib/milling/api";
import { idsBody } from "@/lib/milling/reports/approve-ids";
import { retireSeller } from "@/lib/milling/sellers/trips";
import { prisma } from "@/lib/prisma";

/** Stop the ticked sellers selling; refused for one who is out or owes money. */
export const POST = millRoute("seller.manage", async ({ companyId, userId }, request) => {
  const { ids } = await readBody(request, idsBody);
  for (const id of ids) await retireSeller(prisma, { companyId, userId, sellerId: id });
  return { stopped: ids.length };
});
