import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { currentOpening, removeOpeningLine, setOpeningLine } from "@/lib/milling/setup/go-live";
import { prisma } from "@/lib/prisma";

const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set"),
    productId: z.string().uuid("Choose the item."),
    stockLocationId: z.string().uuid("Choose where it is."),
    quantity: z.coerce.number().positive("A count is more than nothing."),
    unitCost: z.coerce.number().min(0, "A cost is nothing or more."),
  }),
  z.object({ action: z.literal("remove"), lineId: z.string().uuid() }),
]);

/** Type, change or take off a count on the draft opening stock. */
export const POST = millRoute("stock.count", async ({ companyId, userId }, request) => {
  const input = await readBody(request, body);
  const opening = await currentOpening(prisma, { companyId, userId, create: true });
  if (input.action === "remove") return removeOpeningLine(prisma, { companyId, openingId: opening!.id, lineId: input.lineId });
  return setOpeningLine(prisma, { companyId, userId, openingId: opening!.id, productId: input.productId, stockLocationId: input.stockLocationId, quantity: input.quantity, unitCost: input.unitCost });
});
