import { millRoute } from "@/lib/milling/api";
import { millDashboard } from "@/lib/milling/reports/dashboard";
import { prisma } from "@/lib/prisma";

export const GET = millRoute(null, async ({ companyId }) => millDashboard(prisma, companyId));
