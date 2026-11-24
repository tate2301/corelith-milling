import { z } from "zod";

import { booksActor } from "@/lib/books/core/can-do";
import { millRefusal, millRoute, readBody } from "@/lib/milling/api";
import { postMillSale } from "@/lib/milling/books/sales";
import { prisma } from "@/lib/prisma";

const body = z.object({ ids: z.array(z.string().uuid()).min(1).max(50), bankAccountId: z.string().uuid().nullable().optional() });

/** Post the ticked office sales to Books; each answers for itself. Books' own rights decide. */
export const POST = millRoute(null, async ({ session }, request) => {
  const { ids, bankAccountId } = await readBody(request, body);
  const actor = await booksActor(session);
  const results: Array<{ id: string; ok: boolean; message: string }> = [];
  for (const id of ids) {
    try {
      await postMillSale(prisma, actor, { saleId: id, bankAccountId: bankAccountId ?? null });
      results.push({ id, ok: true, message: "Posted" });
    } catch (error) {
      results.push({ id, ok: false, message: error instanceof Error ? error.message : "Not posted." });
    }
  }
  if (!results.some((row) => row.ok)) throw millRefusal(results.map((row) => row.message).join(" "));
  return { results };
});
