import { NextResponse, type NextRequest } from "next/server";

import { successResponse } from "@/lib/api-response";
import { validateSession } from "@/lib/api-utils";
import { loadMillAccess, MILL_FEATURE } from "@/lib/milling/access/server";

/** What the signed-in person may do at the mill; screens read it to show only their own actions. */
export async function GET(request: NextRequest) {
  const result = await validateSession(request);
  if (result instanceof NextResponse) return result;
  const { user } = result.session;
  if (!user.enabledFeatures?.includes(MILL_FEATURE)) {
    return successResponse({ canView: false, groups: [], capabilities: [] });
  }
  return successResponse(await loadMillAccess(user));
}
