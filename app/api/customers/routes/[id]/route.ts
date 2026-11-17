import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, successResponse, validateSession } from "@/lib/api-utils";
import { readCustomerRoute, RouteRefusal, updateCustomerRoute } from "@/lib/customers/routes";

const updateSchema = z.object({
  code: z.string().trim().min(1).max(20).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  visitDays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  repUserId: z.string().uuid().nullable().optional(),
  vehicleId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

/** A route with its customers in visiting order. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sessionResult = await validateSession(request);
    if (sessionResult instanceof NextResponse) return sessionResult;
    const route = await readCustomerRoute(sessionResult.session.user.companyId, (await params).id);
    return route ? successResponse(route) : errorResponse("Route not found", 404);
  } catch (error) {
    console.error("[API] GET /api/customers/routes/[id] error:", error);
    return errorResponse("Could not read the route");
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sessionResult = await validateSession(request);
    if (sessionResult instanceof NextResponse) return sessionResult;
    const validated = updateSchema.parse(await request.json());
    return successResponse(await updateCustomerRoute(sessionResult.session.user.companyId, (await params).id, validated));
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse("Validation failed", 400, error.issues);
    if (error instanceof RouteRefusal) return errorResponse(error.message, error.status);
    console.error("[API] PATCH /api/customers/routes/[id] error:", error);
    return errorResponse("Could not change the route");
  }
}
