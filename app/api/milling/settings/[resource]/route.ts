import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api-response";
import { requireMill } from "@/lib/milling/access/server";
import { createSetting, listSettings, MillSettingsError } from "@/lib/milling/settings/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ resource: string }> };

/** One of the mill's settings lists. Anyone at the mill may read it; the forms that use it need it. */
export async function GET(request: NextRequest, { params }: Params) {
  const context = await requireMill(request);
  if (context instanceof NextResponse) return context;
  const { resource } = await params;
  try {
    return successResponse(await listSettings(prisma, context.companyId, resource));
  } catch (error) {
    if (error instanceof MillSettingsError) return errorResponse(error.message, error.status);
    throw error;
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const context = await requireMill(request, "settings.manage");
  if (context instanceof NextResponse) return context;
  const { resource } = await params;
  try {
    const row = await createSetting(prisma, {
      companyId: context.companyId,
      actorId: context.userId,
      key: resource,
      body: await request.json().catch(() => null),
    });
    return successResponse(row, 201);
  } catch (error) {
    if (error instanceof MillSettingsError) return errorResponse(error.message, error.status);
    throw error;
  }
}
