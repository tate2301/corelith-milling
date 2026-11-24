import { millRefusal, millRoute } from "@/lib/milling/api";
import { currentOpening, postOpening } from "@/lib/milling/setup/go-live";
import { prisma } from "@/lib/prisma";

/** Post the opening stock to stock and Books (GL-B2). Management's to approve, after the screen asks once more. */
export const POST = millRoute("stock.adjust.approve", async ({ companyId, userId }) => {
  const opening = await currentOpening(prisma, { companyId, userId });
  if (!opening) throw millRefusal("Count the opening stock first.");
  return postOpening(prisma, { companyId, userId, openingId: opening.id });
});
