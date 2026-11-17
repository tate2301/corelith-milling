import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { errorResponse, successResponse } from "@/lib/api-response";
import { MILL_GROUPS } from "@/lib/milling/access/groups";
import { listMillMembers, MillMembershipError, setMillGroups } from "@/lib/milling/access/membership";
import { requireMill } from "@/lib/milling/access/server";
import { prisma } from "@/lib/prisma";

/** The mill's groups and everyone's place in them. */
export async function GET(request: NextRequest) {
  const context = await requireMill(request, "settings.manage");
  if (context instanceof NextResponse) return context;
  const members = await listMillMembers(prisma, context.companyId);
  return successResponse({ groups: MILL_GROUPS, members });
}

const body = z.object({ userId: z.string().uuid(), groups: z.array(z.string()).max(8) });

/** Put one person in exactly the groups given. */
export async function PUT(request: NextRequest) {
  const context = await requireMill(request, "settings.manage");
  if (context instanceof NextResponse) return context;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("Send a userId and the list of groups.", 400);
  try {
    const groups = await setMillGroups(prisma, {
      companyId: context.companyId,
      actorId: context.userId,
      userId: parsed.data.userId,
      groups: parsed.data.groups,
    });
    return successResponse({ userId: parsed.data.userId, groups });
  } catch (error) {
    if (error instanceof MillMembershipError) return errorResponse(error.message, 400);
    throw error;
  }
}
