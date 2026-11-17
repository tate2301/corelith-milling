import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, successResponse, validateSession } from "@/lib/api-utils";
import { MeterRefusal, recordMeterReading } from "@/lib/maintenance/meters";
import { prisma } from "@/lib/prisma";

const readingSchema = z.object({
  reading: z.number().min(0),
  readAt: z.string().datetime().optional(),
  source: z.string().trim().min(1).max(40).optional(),
});

async function ownEquipment(id: string, companyId: string) {
  const equipment = await prisma.equipment.findUnique({ where: { id }, select: { id: true, site: { select: { companyId: true } } } });
  return equipment && equipment.site.companyId === companyId ? equipment : null;
}

/** An equipment's meter readings, newest first. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sessionResult = await validateSession(request);
    if (sessionResult instanceof NextResponse) return sessionResult;
    const { id } = await params;
    if (!(await ownEquipment(id, sessionResult.session.user.companyId))) return errorResponse("Equipment not found", 404);
    const readings = await prisma.meterReading.findMany({
      where: { equipmentId: id },
      orderBy: { readAt: "desc" },
      take: 100,
      include: { recordedBy: { select: { name: true } } },
    });
    return successResponse({ readings });
  } catch (error) {
    console.error("[API] GET /api/equipment/[id]/meter-readings error:", error);
    return errorResponse("Could not read the meter readings");
  }
}

/** Records a reading typed by hand; a reading that goes back is refused. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sessionResult = await validateSession(request);
    if (sessionResult instanceof NextResponse) return sessionResult;
    const { user } = sessionResult.session;
    const { id } = await params;
    if (!(await ownEquipment(id, user.companyId))) return errorResponse("Equipment not found", 404);
    const validated = readingSchema.parse(await request.json());
    const reading = await recordMeterReading({
      companyId: user.companyId,
      equipmentId: id,
      reading: validated.reading,
      readAt: validated.readAt ? new Date(validated.readAt) : undefined,
      source: validated.source ?? "MANUAL",
      recordedById: user.id,
    });
    return successResponse(reading, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse("Validation failed", 400, error.issues);
    if (error instanceof MeterRefusal) return errorResponse(error.message, 400);
    console.error("[API] POST /api/equipment/[id]/meter-readings error:", error);
    return errorResponse("Could not record the reading");
  }
}
