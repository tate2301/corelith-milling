import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { cancelSellerTrip, settleSellerTrip } from "@/lib/milling/sellers/trips";
import { millRefusal } from "@/lib/milling/errors";
import { sellersBoard } from "@/lib/milling/sellers/views";
import { prisma } from "@/lib/prisma";

const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("settle"),
    returned: z.array(z.object({ productId: z.string().uuid(), bags: z.coerce.number().int().min(0) })),
    discounts: z.array(z.object({ productId: z.string().uuid(), discount: z.coerce.number().positive(), bags: z.coerce.number().int().positive() })),
    cashReceived: z.coerce.number().min(0, "Enter the cash handed in."),
    notes: z.string().max(2000).nullable().optional(),
  }),
  z.object({ action: z.literal("cancel"), reason: z.string().min(1, "Say why the trip is called off.").max(500) }),
]);

/** Settle a trip when the seller is back, or call it off before anything is sold. */
export const POST = millRoute<{ id: string }>("seller.manage", async ({ companyId, userId }, request, { id }) => {
  const input = await readBody(request, body);
  if (input.action === "cancel") return cancelSellerTrip(prisma, { companyId, userId, tripId: id, reason: input.reason });
  return settleSellerTrip(prisma, { companyId, userId, tripId: id, returned: input.returned, discounts: input.discounts, cashReceived: input.cashReceived, notes: input.notes });
});

/** One trip, as the Sellers board shows it, with the mill's discount rules and what the seller owed: for its settle sheet. */
export const GET = millRoute<{ id: string }>(null, async ({ companyId }, _request, { id }) => {
  const row = await prisma.millingSellerTrip.findFirst({ where: { id, companyId }, select: { tripDate: true } });
  if (!row) throw millRefusal("That trip is not here.");
  const board = await sellersBoard(prisma, companyId, row.tripDate.toISOString().slice(0, 10));
  const trip = board.trips.find((entry) => entry.id === id);
  if (!trip) throw millRefusal("That trip is not here.");
  return { trip, rules: board.rules, seller: board.sellers.find((seller) => seller.id === trip.sellerId) ?? null };
});
