import { NextRequest, NextResponse } from "next/server";

import { errorResponse, successResponse, validateSession } from "@/lib/api-utils";
import { readExtensionNav } from "@/lib/extensions/nav-server";

/** What the registered extensions add to this person's sidebar: row counts, start page and phone bar. */
export async function GET(request: NextRequest) {
  try {
    const sessionResult = await validateSession(request);
    if (sessionResult instanceof NextResponse) return sessionResult;
    const { user } = sessionResult.session;
    const reading = await readExtensionNav(
      { userId: user.id, companyId: user.companyId, role: user.role ?? null },
      { role: user.role, enabledFeatures: user.enabledFeatures, workspaceProfile: user.workspaceProfile },
    );
    return successResponse(reading);
  } catch (error) {
    console.error("[API] GET /api/extensions/nav error:", error);
    return errorResponse("Could not read the extensions' sidebar");
  }
}
