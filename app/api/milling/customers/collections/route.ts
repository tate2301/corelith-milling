import { millRoute } from "@/lib/milling/api";
import { collections } from "@/lib/milling/customers/customers";
import { prisma } from "@/lib/prisma";

/** Collections (CU-A1): who owes, what is overdue, against their limit, with their latest promise. */
export const GET = millRoute(null, async ({ companyId }) => collections(prisma, companyId));
