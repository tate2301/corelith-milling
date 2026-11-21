import { z } from "zod";

import { fetchJson } from "@/lib/api-client";
import { DECISION_LABEL } from "@/lib/milling/exceptions/words";
import type { SheetKind } from "@/lib/workspace/sheet-kind";

type Loaded = { code: string; title: string; detail: string | null; typeLabel: string; severity: string; allowedDecisions: string[]; status: string };

const labelOf = (decision: string) => DECISION_LABEL[decision] ?? decision;

/**
 * Decide an exception (F4): one of the decisions it allows, and why. The
 * reason stays with the record; the record it held up moves on as decided.
 */
const decide: SheetKind = {
  title: (_ctx, values) => `Decide ${String(values._code ?? "")}`.trim(),
  sub: (_ctx, values) => String(values._title ?? ""),
  cur: "US$",
  load: async (ctx) => {
    const row = await fetchJson<Loaded>(`/api/milling/exceptions/${ctx.id}`);
    return {
      _code: row.code,
      _title: row.title,
      _what: `${row.typeLabel} · ${row.severity.toLowerCase()}${row.detail ? `. ${row.detail}` : ""}`,
      _decisions: row.allowedDecisions,
      decision: row.allowedDecisions[0] ? labelOf(row.allowedDecisions[0]) : "",
    };
  },
  sections: [
    {
      fields: [
        { id: "_what", t: "read", l: "What happened", v: "" },
        { id: "decision", t: "seg", l: "Decision", o: (values) => ((values._decisions as string[] | undefined) ?? []).map(labelOf) },
        { id: "note", t: "area", l: "Why", rows: 3, p: "Kept with the record", needed: "Say why: it is kept with the record.", schema: z.string().trim().min(3, "Say why: it is kept with the record.").max(2000) },
      ],
    },
  ],
  note: "The decision is final. The record it held up moves on as decided.",
  primary: "Decide",
  done: (_result, values) => `${String(values._code ?? "Exception")} decided: ${String(values.decision ?? "")}`,
  submit: (values, ctx) => {
    const decisions = (values._decisions as string[] | undefined) ?? [];
    const decision = decisions.find((key) => labelOf(key) === values.decision) ?? decisions[0];
    return { method: "POST", url: `/api/milling/exceptions/${ctx.id}/decide`, body: { decision, note: String(values.note ?? "").trim() } };
  },
  invalidate: [["list"], ["milling"]],
  requires: [["ext:milling", "exception.decide"]],
};

export const EXCEPTION_SHEETS: Record<string, SheetKind> = {
  "mill-exception-decide": decide,
};
