import { z } from "zod";

/** What a route form sends: its code, name, visit days and usual vehicle. */
export const routeBody = z.object({
  code: z.string().trim().min(1, "Give the route a code.").max(20),
  name: z.string().trim().min(1, "Name the route.").max(100),
  visitDays: z.array(z.coerce.number().int().min(1).max(7)).max(7),
  vehicleId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});
