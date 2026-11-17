import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, successResponse, validateSession } from "@/lib/api-utils";
import { createCustomerRoute, RouteRefusal } from "@/lib/customers/routes";
import { prisma } from "@/lib/prisma";

export const routeSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  visitDays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
  repUserId: z.string().uuid().nullable().optional(),
  vehicleId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

/** The company's customer routes, with how many customers each holds. */
export async function GET(request: NextRequest) {
  try {
    const sessionResult = await validateSession(request);
    if (sessionResult instanceof NextResponse) return sessionResult;
    const { companyId } = sessionResult.session.user;
    const routes = await prisma.customerRoute.findMany({
      where: { companyId },
      orderBy: [{ isActive: "desc" }, { code: "asc" }],
      include: {
        rep: { select: { id: true, name: true } },
        vehicle: { select: { id: true, name: true, registrationNumber: true } },
        _count: { select: { customers: true } },
      },
    });
    return successResponse({ routes });
  } catch (error) {
    console.error("[API] GET /api/customers/routes error:", error);
    return errorResponse("Could not list the routes");
  }
}

export async function POST(request: NextRequest) {
  try {
    const sessionResult = await validateSession(request);
    if (sessionResult instanceof NextResponse) return sessionResult;
    const validated = routeSchema.parse(await request.json());
    return successResponse(await createCustomerRoute(sessionResult.session.user.companyId, validated), 201);
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse("Validation failed", 400, error.issues);
    if (error instanceof RouteRefusal) return errorResponse(error.message, error.status);
    console.error("[API] POST /api/customers/routes error:", error);
    return errorResponse("Could not create the route");
  }
}
