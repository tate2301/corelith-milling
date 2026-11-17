import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { decideAndApply } from "@/lib/milling/exceptions/decide";
import { prisma } from "@/lib/prisma";

const body = z.object({ decision: z.string().min(1), note: z.string().max(2000) });

export const POST = millRoute<{ id: string }>("exception.decide", async ({ companyId, userId }, request, { id }) =>
  decideAndApply(prisma, { companyId, deciderId: userId, exceptionId: id, ...(await readBody(request, body)) }),
);
