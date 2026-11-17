import { millRoute } from "@/lib/milling/api";
import { endDowntime } from "@/lib/milling/maintenance/equipment";
import { prisma } from "@/lib/prisma";

export const POST = millRoute<{ id: string }>("fault.report", async ({ companyId, userId }, _request, { id }) => endDowntime(prisma, { companyId, userId, downtimeId: id }));
