import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { errorResponse, successResponse, validateSession, type AuthenticatedSession } from "@/lib/api-utils";

import { MeterRefusal } from "./meters";
import { PlanRefused } from "./plans";
import { WorkOrderRefused } from "./work-orders";

/**
 * A maintenance API route: signed in (the proxy has already checked the
 * feature against the route registry), its body read with a schema, and a
 * refusal (a plan with no interval, a meter going back) answered as a 400 in
 * its own words.
 */
export function maintenanceRoute<P = Record<string, string>>(handler: (session: AuthenticatedSession, request: NextRequest, params: P) => Promise<unknown>) {
  return async (request: NextRequest, segment: { params: Promise<P> }) => {
    const result = await validateSession(request);
    if (result instanceof NextResponse) return result;
    try {
      const body = await handler(result.session, request, segment ? await segment.params : ({} as P));
      if (body instanceof NextResponse) return body;
      return successResponse(body, request.method === "POST" ? 201 : 200);
    } catch (error) {
      if (error instanceof PlanRefused || error instanceof MeterRefusal || error instanceof WorkOrderRefused) return errorResponse(error.message, 400);
      if (error instanceof z.ZodError) return errorResponse(error.issues[0]?.message ?? "Check what was sent.", 400);
      throw error;
    }
  };
}

export async function readBody<T>(request: NextRequest, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(await request.json().catch(() => ({})));
}

export const idsBody = z.object({ ids: z.array(z.string().uuid()).min(1, "Tick at least one.").max(100) });
