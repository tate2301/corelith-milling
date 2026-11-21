import { z } from "zod";

import { millRefusal } from "../errors";

import type { BulkKind } from "./decide-many";

/** The body a list's Approve sends: the ticked rows' ids. */
export const idsBody = z.object({ ids: z.array(z.string().uuid()).min(1, "Tick at least one.").max(50, "Approve 50 or fewer at a time.") });

/** One press from a list over many records: refused only when none of them went, in their own words. */
export function answerFor(kind: BulkKind, results: Array<{ ok: boolean; message: string }>) {
  const done = results.filter((row) => row.ok);
  if (!done.length) throw millRefusal(results.map((row) => row.message).join(" ") || `Nothing was approved.`);
  return { kind, results };
}
