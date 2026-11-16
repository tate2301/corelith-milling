import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api-response";
import { requireMill } from "@/lib/milling/access/server";
import { getGeneralSettings, MillSettingsError, updateGeneralSettings } from "@/lib/milling/settings/server";
import { prisma } from "@/lib/prisma";

/** Tolerances and the shift template. */
export async function GET(request: NextRequest) {
  const context = await requireMill(request);
  if (context instanceof NextResponse) return context;
  return successResponse(await getGeneralSettings(prisma, context.companyId));
}

export async function PUT(request: NextRequest) {
  const context = await requireMill(request, "settings.manage");
  if (context instanceof NextResponse) return context;
  try {
    return successResponse(
      await updateGeneralSettings(prisma, {
        companyId: context.companyId,
        actorId: context.userId,
        body: await request.json().catch(() => null),
      }),
    );
  } catch (error) {
    if (error instanceof MillSettingsError) return errorResponse(error.message, error.status);
    throw error;
  }
}
