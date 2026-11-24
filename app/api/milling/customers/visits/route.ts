import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { listVisits, recordVisit } from "@/lib/milling/customers/customers";
import { prisma } from "@/lib/prisma";

const day = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : undefined);

/** Visits, newest first; a rep who records visits but decides nothing sees their own. */
export const GET = millRoute(null, async ({ companyId, userId, access }, request) => {
  const params = new URL(request.url).searchParams;
  const onlyMine = access.capabilities.includes("visit.record") && !access.capabilities.includes("exception.decide");
  return {
    rows: await listVisits(prisma, companyId, {
      from: day(params.get("from")),
      to: day(params.get("to")),
      routeId: params.get("route"),
      repUserId: onlyMine || params.get("mine") === "1" ? userId : null,
    }),
  };
});

const num = z.preprocess((value) => (value === "" || value === undefined ? null : value), z.coerce.number().nullable().optional());
const body = z.object({
  customerId: z.string().uuid("Choose the shop."),
  routeId: z.string().uuid().nullable().optional(),
  competitorPrice: num,
  ourBagsOnShelf: z.preprocess((value) => (value === "" || value === undefined ? null : value), z.coerce.number().int().nullable().optional()),
  shelfSharePct: num,
  photoUrl: z.string().url().max(2000).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  latitude: num,
  longitude: num,
});

/** Record a shop visit and what was seen there (HM-D1). */
export const POST = millRoute("visit.record", async ({ companyId, userId }, request) => recordVisit(prisma, { companyId, userId, ...(await readBody(request, body)) }));
