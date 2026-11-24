import { maintenanceRoute } from "@/lib/maintenance/api";
import { maintenanceHome } from "@/lib/maintenance/overview";
import { prisma } from "@/lib/prisma";

/** The Assets homepage: what is down, what is due, the open work and the fuel going out. */
export const GET = maintenanceRoute(async (session) => maintenanceHome(prisma, session.user.companyId));
