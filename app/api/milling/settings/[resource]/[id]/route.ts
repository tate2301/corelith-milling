import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api-response";
import { requireMill } from "@/lib/milling/access/server";
import { MillSettingsError, updateSetting } from "@/lib/milling/settings/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ resource: string; id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const context = await requireMill(request, "settings.manage");
  if (context instanceof NextResponse) return context;
  const { resource, id } = await params;
  try {
    const row = await updateSetting(prisma, {
      companyId: context.companyId,
      actorId: context.userId,
      key: resource,
      id,
      body: await request.json().catch(() => null),
    });
    return successResponse(row);
  } catch (error) {
    if (error instanceof MillSettingsError) return errorResponse(error.message, error.status);
    throw error;
  }
}
