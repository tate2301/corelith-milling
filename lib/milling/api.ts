import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";

import { errorResponse, successResponse } from "@/lib/api-response";

import type { MillCapability } from "./access/groups";
import { requireMill, type MillContext } from "./access/server";
import { ExceptionError } from "./exceptions/exceptions";
import { IntakeError } from "./intake/intake";
import { QcError } from "./quality/inspect";
import { AmendmentError } from "./records/amend";
import { CountError } from "./stock/counts";
import { StockLedgerError } from "./stock/ledger";

/** Errors a mill service throws to say no: shown to the person as they are. */
const REFUSALS = [IntakeError, QcError, ExceptionError, StockLedgerError, CountError, AmendmentError];

export function isRefusal(error: unknown): error is Error {
  return REFUSALS.some((kind) => error instanceof kind) || (error instanceof Error && error.name === "MillRefusal");
}

export { millRefusal } from "./errors";

type Handler<P> = (context: MillContext, request: NextRequest, params: P) => Promise<unknown>;

/**
 * A mill route: the guard, then the handler, with a service's refusal
 * answered as 400 in the person's words. The handler returns the body.
 */
export function millRoute<P = Record<string, string>>(capability: MillCapability | null, handler: Handler<P>) {
  return async (request: NextRequest, segment: { params: Promise<P> }) => {
    const context = await requireMill(request, capability ?? undefined);
    if (context instanceof NextResponse) return context;
    try {
      const body = await handler(context, request, segment ? await segment.params : ({} as P));
      if (body instanceof NextResponse) return body;
      return successResponse(body, request.method === "POST" ? 201 : 200);
    } catch (error) {
      if (isRefusal(error)) return errorResponse(error.message, 400);
      if (error instanceof ZodError) return errorResponse(error.issues[0]?.message ?? "Those values were not accepted.", 400);
      throw error;
    }
  };
}

export async function readBody<T>(request: NextRequest, schema: ZodType<T>): Promise<T> {
  return schema.parse(await request.json().catch(() => null));
}
