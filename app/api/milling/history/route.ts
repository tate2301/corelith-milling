import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api-response";
import { requireMill } from "@/lib/milling/access/server";
import { recordHistory } from "@/lib/milling/records/history";
import { prisma } from "@/lib/prisma";

/** A mill record's history: `?entityType=MillingIntake&entityId=<id>`. Only the mill's own records. */
export async function GET(request: NextRequest) {
  const context = await requireMill(request);
  if (context instanceof NextResponse) return context;
  const { searchParams } = new URL(request.url);
  const entityType = searchParams.get("entityType") ?? "";
  const entityId = searchParams.get("entityId") ?? "";
  if (!/^(Milling[A-Za-z]+|milling\.[a-z-]+)$/.test(entityType) || !entityId) {
    return errorResponse("Name a mill record: entityType and entityId.", 400);
  }
  return successResponse(await recordHistory(prisma, { companyId: context.companyId, entityType, entityId }));
}
