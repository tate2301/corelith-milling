import { millRoute } from "@/lib/milling/api";
import { EXCEPTION_TYPES } from "@/lib/milling/exceptions/exceptions";
import { prisma } from "@/lib/prisma";

/** The exceptions queue: `?status=OPEN` (default) or `DECIDED`. */
export const GET = millRoute(null, async ({ companyId }, request) => {
  const status = new URL(request.url).searchParams.get("status") === "DECIDED" ? "DECIDED" : "OPEN";
  const [rows, open] = await Promise.all([
    prisma.millingException.findMany({
      where: { companyId, status },
      orderBy: status === "OPEN" ? [{ createdAt: "asc" }] : [{ decidedAt: "desc" }],
      take: 200,
    }),
    prisma.millingException.count({ where: { companyId, status: "OPEN" } }),
  ]);
  const people = await prisma.user.findMany({
    where: { companyId, id: { in: [...new Set(rows.flatMap((row) => [row.raisedById, row.decidedById]).filter((id): id is string => Boolean(id)))] } },
    select: { id: true, name: true },
  });
  const name = (id: string | null) => people.find((person) => person.id === id)?.name ?? null;
  return {
    open,
    rows: rows.map((row) => ({ ...row, typeLabel: EXCEPTION_TYPES[row.type as keyof typeof EXCEPTION_TYPES] ?? row.type, raisedBy: name(row.raisedById), decidedBy: name(row.decidedById) })),
  };
});
