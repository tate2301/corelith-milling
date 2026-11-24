import { maintenanceRoute } from "@/lib/maintenance/api";
import { readEquipmentRecord } from "@/lib/maintenance/equipment-record";
import { PlanRefused } from "@/lib/maintenance/plans";
import { prisma } from "@/lib/prisma";

/** One machine or vehicle, for its record. */
export const GET = maintenanceRoute<{ id: string }>(async (session, _request, { id }) => {
  const record = await readEquipmentRecord(prisma, session.user.companyId, id);
  if (!record) throw new PlanRefused("That is not in this workspace's register.");
  return record;
});
