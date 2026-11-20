import { z } from "zod";

import { millRoute, readBody } from "@/lib/milling/api";
import { addSeller } from "@/lib/milling/sellers/trips";
import { sellersBoard } from "@/lib/milling/sellers/views";
import { prisma } from "@/lib/prisma";

/** The sellers, what each owes, and the day's trips. */
export const GET = millRoute(null, async ({ companyId }, request) => sellersBoard(prisma, companyId, new URL(request.url).searchParams.get("date")));

const body = z.object({ employeeId: z.string().uuid("Choose the employee.") });

/** Make an employee a seller. */
export const POST = millRoute("seller.manage", async ({ companyId, userId }, request) => addSeller(prisma, { companyId, userId, ...(await readBody(request, body)) }));
