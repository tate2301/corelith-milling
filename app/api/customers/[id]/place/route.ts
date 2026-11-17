import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, successResponse, validateSession } from "@/lib/api-utils";
import { placeCustomer, RouteRefusal } from "@/lib/customers/routes";
import { prisma } from "@/lib/prisma";

const placeSchema = z.object({
  routeId: z.string().uuid().nullable().optional(),
  routeStop: z.number().int().min(1).nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
});

/** Puts a customer on a route at a stop, takes them off, or records where they are. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sessionResult = await validateSession(request);
    if (sessionResult instanceof NextResponse) return sessionResult;
    const { id } = await params;
    const validated = placeSchema.parse(await request.json());
    const customer = await prisma.$transaction((tx) => placeCustomer(sessionResult.session.user.companyId, id, validated, tx));
    return successResponse(customer);
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse("Validation failed", 400, error.issues);
    if (error instanceof RouteRefusal) return errorResponse(error.message, error.status);
    console.error("[API] PUT /api/customers/[id]/place error:", error);
    return errorResponse("Could not place the customer");
  }
}
