import { NextResponse, type NextRequest } from "next/server";

import { successResponse } from "@/lib/api-response";
import { validateSession } from "@/lib/api-utils";
import { loadMillAccess, MILL_FEATURE } from "@/lib/milling/access/server";
import { prisma } from "@/lib/prisma";

/** Who can put a person in the mill's groups: the mill's administrators, else the workspace's managers. */
async function whoGivesAccess(companyId: string): Promise<string[]> {
  const admins = await prisma.millingGroupMember.findMany({ where: { companyId, groupCode: "ADMIN" }, select: { userId: true }, take: 3 });
  const people = await prisma.user.findMany({
    where: { companyId, isActive: true, ...(admins.length ? { id: { in: admins.map((row) => row.userId) } } : { role: { in: ["SUPERADMIN", "MANAGER"] } }) },
    select: { name: true },
    orderBy: { name: "asc" },
    take: 2,
  });
  return people.map((person) => person.name).filter((name): name is string => Boolean(name));
}

/** What the signed-in person may do at the mill; screens read it to show only their own actions. */
export async function GET(request: NextRequest) {
  const result = await validateSession(request);
  if (result instanceof NextResponse) return result;
  const { user } = result.session;
  if (!user.enabledFeatures?.includes(MILL_FEATURE)) {
    return successResponse({ canView: false, groups: [], capabilities: [] });
  }
  const access = await loadMillAccess(user);
  // Someone in no group sees the no-access page, which says who can let them in.
  return successResponse(access.canView ? access : { ...access, askFor: await whoGivesAccess(user.companyId) });
}
