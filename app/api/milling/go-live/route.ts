import { millRoute } from "@/lib/milling/api";
import { goLiveSteps } from "@/lib/milling/setup/go-live";
import { prisma } from "@/lib/prisma";

/** Go-live (GL-A1): the seven steps, each with its state read from what is there. */
export const GET = millRoute(null, async ({ companyId }) => ({ steps: await goLiveSteps(prisma, companyId) }));
