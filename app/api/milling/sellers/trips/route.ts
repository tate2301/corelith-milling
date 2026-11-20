import { z } from "zod";

import { can } from "@/lib/milling/access/groups";
import { millRoute, readBody } from "@/lib/milling/api";
import { issueSellerTrip } from "@/lib/milling/sellers/trips";
import { prisma } from "@/lib/prisma";

const body = z.object({
  sellerId: z.string().uuid("Choose the seller."),
  fromLocationId: z.string().uuid("Choose the store."),
  lines: z.array(z.object({ productId: z.string().uuid(), bags: z.coerce.number().int().positive() })).min(1, "Add at least one product."),
  overrideReason: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

/** Bags out to a seller. A manager may let out a seller who still owes, with a reason. */
export const POST = millRoute("seller.manage", async ({ companyId, userId, access }, request) =>
  issueSellerTrip(prisma, { companyId, userId, mayOverride: can(access, "exception.decide"), ...(await readBody(request, body)) }),
);
