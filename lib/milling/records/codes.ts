import type { Prisma } from "@prisma/client";

/** YYMMDD in the mill's day (Harare, UTC+2), so a night shift's records after midnight carry the new date. */
export function millDayStamp(at: Date = new Date()): string {
  const local = new Date(at.getTime() + 2 * 60 * 60 * 1000);
  return local.toISOString().slice(2, 10).replace(/-/g, "");
}

type CodeTable =
  | "millingIntake"
  | "millingLot"
  | "millingException"
  | "millingStockCount"
  | "millingProductionOrder"
  | "millingBatch"
  | "millingPackRun"
  | "millingCustomerOrder"
  | "millingDelivery"
  | "millingSellerTrip"
  | "millingOpeningStock";

/**
 * The next code in a day's series, e.g. MI-261116-03. Read inside the
 * caller's transaction; the table's unique (companyId, code) catches the rare
 * race, and the caller's request fails rather than two records sharing a code.
 */
export async function nextDailyCode(
  tx: Prisma.TransactionClient,
  table: CodeTable,
  companyId: string,
  prefix: string,
  at: Date = new Date(),
): Promise<string> {
  const stem = `${prefix}-${millDayStamp(at)}-`;
  const where = { companyId, code: { startsWith: stem } };
  const delegate = tx[table] as unknown as {
    findFirst: (args: unknown) => Promise<{ code: string } | null>;
  };
  const last = await delegate.findFirst({ where, orderBy: { code: "desc" }, select: { code: true } });
  const next = last ? Number(last.code.slice(stem.length)) + 1 : 1;
  return `${stem}${String(next).padStart(2, "0")}`;
}
