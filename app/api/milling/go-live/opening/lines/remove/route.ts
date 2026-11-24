import { millRefusal, millRoute, readBody } from "@/lib/milling/api";
import { idsBody } from "@/lib/milling/reports/approve-ids";
import { currentOpening, removeOpeningLine } from "@/lib/milling/setup/go-live";
import { prisma } from "@/lib/prisma";

/** Take the ticked counts off the draft opening stock. */
export const POST = millRoute("stock.count", async ({ companyId, userId }, request) => {
  const { ids } = await readBody(request, idsBody);
  const opening = await currentOpening(prisma, { companyId, userId });
  if (!opening) throw millRefusal("Count the opening stock first.");
  for (const lineId of ids) await removeOpeningLine(prisma, { companyId, openingId: opening.id, lineId });
  return { removed: ids.length };
});
