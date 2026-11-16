import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { updateAssignment } from "@/lib/milling/production/shifts";
import { prisma } from "@/lib/prisma";

const body = z.object({
  employeeId: z.string().uuid(),
  dutyId: z.string().uuid().nullable().optional(),
  attendance: z.enum(["PRESENT", "ABSENT", "LATE", "ON_LEAVE"]).optional(),
  clockIn: z.string().datetime().nullable().optional(),
  clockOut: z.string().datetime().nullable().optional(),
  breakMinutes: z.coerce.number().int().min(0).max(600).optional(),
  absenceReason: z.string().max(500).nullable().optional(),
  remove: z.boolean().optional(),
});

/** Add, change or remove one person on the shift. */
export const POST = millRoute<{ id: string }>("shift.manage", async ({ companyId, userId }, request, { id }) =>
  updateAssignment(prisma, { companyId, userId, shiftId: id, ...(await readBody(request, body)) }),
);
