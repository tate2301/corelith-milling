import { NextResponse, type NextRequest } from "next/server";

import { validateSession, type AuthenticatedSession } from "@/lib/api-utils";
import { prisma } from "@/lib/prisma";

import { can, millAccessFor, type MillAccess, type MillCapability } from "./groups";

/** The feature every milling API needs on; finer workflows add their own as they land. */
export const MILL_FEATURE = "milling.home";

/** A person's mill access, read from their groups. */
export async function loadMillAccess(user: { id: string; role: string; companyId: string }): Promise<MillAccess> {
  const rows = await prisma.millingGroupMember.findMany({
    where: { userId: user.id, companyId: user.companyId },
    select: { groupCode: true },
  });
  return millAccessFor(user.role, rows.map((row) => row.groupCode));
}

export interface MillContext {
  session: AuthenticatedSession;
  companyId: string;
  userId: string;
  access: MillAccess;
}

function refuse(message: string, status = 403) {
  return NextResponse.json({ error: message, code: "MILL_ACCESS" }, { status });
}

/**
 * The guard every `/api/milling` handler starts with: a signed-in member of a
 * workspace running the mill, who may see it, and, when `capability` is given,
 * holds it through their role or a group.
 */
export async function requireMill(
  request: NextRequest,
  capability?: MillCapability,
): Promise<MillContext | NextResponse> {
  const result = await validateSession(request);
  if (result instanceof NextResponse) return result;
  const { session } = result;
  if (!session.user.enabledFeatures?.includes(MILL_FEATURE)) {
    return refuse("The mill is not turned on for this workspace.");
  }
  const access = await loadMillAccess(session.user);
  if (!access.canView) return refuse("You are not in any of the mill's groups. Ask an administrator to add you.");
  if (capability && !can(access, capability)) {
    return refuse("Your groups at the mill do not allow this.");
  }
  return { session, companyId: session.user.companyId, userId: session.user.id, access };
}
