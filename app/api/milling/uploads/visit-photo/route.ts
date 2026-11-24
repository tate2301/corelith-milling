import { NextResponse } from "next/server";

import { errorResponse, successResponse } from "@/lib/api-response";
import { requireMill } from "@/lib/milling/access/server";
import { uploadFileToBlob, UploadValidationError } from "@/lib/uploads/upload-file";

export const runtime = "nodejs";

/** A shop visit's photo, from the visit sheet's photo field (multipart `file` → `{ data: { url } }`). */
export async function POST(request: Request) {
  const context = await requireMill(request as never, "visit.record");
  if (context instanceof NextResponse) return context;
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") return errorResponse("No photo was sent.", 400);
  try {
    const uploaded = await uploadFileToBlob({ file, context: "crm-intake-photo", companyId: context.companyId });
    return successResponse(uploaded, 201);
  } catch (error) {
    if (error instanceof UploadValidationError) return errorResponse(error.message, error.status);
    throw error;
  }
}
