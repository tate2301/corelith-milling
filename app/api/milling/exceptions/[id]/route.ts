import { millRefusal, millRoute } from "@/lib/milling/api";
import { EXCEPTION_TYPES } from "@/lib/milling/exceptions/exceptions";
import { prisma } from "@/lib/prisma";

/** One exception, for its decision sheet: what it is, what it holds up and the decisions it allows. */
export const GET = millRoute<{ id: string }>(null, async ({ companyId }, _request, { id }) => {
  const row = await prisma.millingException.findFirst({ where: { id, companyId } });
  if (!row) throw millRefusal("That exception is not here.");
  return { ...row, typeLabel: EXCEPTION_TYPES[row.type as keyof typeof EXCEPTION_TYPES] ?? row.type };
});
