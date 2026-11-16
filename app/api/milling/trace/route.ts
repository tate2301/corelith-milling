import { millRoute } from "@/lib/milling/api";
import { trace } from "@/lib/milling/reports/trace";
import { prisma } from "@/lib/prisma";

/** `?code=` any lot, intake (MI-), batch (B-), pack run (PK-) or delivery (DN-) code. */
export const GET = millRoute(null, async ({ companyId }, request) => trace(prisma, companyId, new URL(request.url).searchParams.get("code") ?? ""));
