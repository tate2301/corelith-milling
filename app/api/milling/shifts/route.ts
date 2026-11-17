import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { planShift } from "@/lib/milling/production/shifts";
import { prisma } from "@/lib/prisma";

export const GET = millRoute(null, async ({ companyId }, request) => {
  const status = new URL(request.url).searchParams.get("status");
  return prisma.millingShift.findMany({
    where: { companyId, ...(status ? { status } : {}) },
    orderBy: { scheduledStart: "desc" },
    take: 100,
    include: { assignments: { select: { attendance: true } } },
  });
});

const body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the day."),
  kind: z.enum(["DAY", "NIGHT"]),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Start time as HH:MM."),
  supervisorId: z.string().uuid().nullable().optional(),
  crew: z.array(z.object({ employeeId: z.string().uuid(), dutyId: z.string().uuid().nullable().optional() })).max(50),
});

export const POST = millRoute("shift.manage", async ({ companyId, userId }, request) => planShift(prisma, { companyId, userId, ...(await readBody(request, body)) }));
