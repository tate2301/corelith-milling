import { fetchJson } from "@/lib/api-client";
import type { Grant, RecordKind } from "@/lib/retail/record-kinds/types";

type Line = { id: string; productId: string; product: string; unit: string | null; stockLocationId: string; place: string; quantity: number; unitCost: number; value: number; posted: boolean };
export type OpeningView = {
  id: string;
  code: string;
  status: string;
  asOf: string;
  postedAt: string | null;
  lines: Line[];
  total: number;
  journal: Array<{ code: string; name: string; debit: number; credit: number }>;
  journalBalanced: boolean;
  warnings: string[];
};

const COUNT: Grant = ["ext:milling", "stock.count"];
const POST: Grant = ["ext:milling", "stock.adjust.approve"];
const money = (value: number) => `US$${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (value: string) => new Date(value).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });

/**
 * Opening stock (GL-B1, GL-B2) on core's RecordFrame: what the mill held on
 * its first day, counted at cost, beside the journal it will post. Posting
 * asks once more, then puts each count into a lot at its place and into
 * Books; a wrong count after that is corrected with a stock count.
 */
export const openingKind: RecordKind<OpeningView> = {
  type: "MillingOpeningStock",
  back: { label: "Go-live", href: "/milling/go-live" },
  queryKey: () => ["milling-opening"],
  load: async () => {
    const answer = await fetchJson<{ opening: OpeningView | null }>("/api/milling/go-live/opening");
    if (!answer.opening) throw new Error("Opening stock is not started. The stores controller counts it, item by item, in each store.");
    return answer.opening;
  },
  title: () => "Opening stock",
  reference: (row) => row.code,
  primary: (row) =>
    row.status === "DRAFT"
      ? {
          key: "post",
          label: "Post opening stock",
          requires: [POST],
          ...(row.lines.length ? {} : { disabled: "Count something first." }),
          do: {
            post: {
              url: "/api/milling/go-live/opening/post",
              done: "Opening stock posted",
              ask: {
                title: "Post opening stock?",
                body: `${money(row.total)} goes on the books at ${day(row.asOf)}, as ${row.lines.length} ${row.lines.length === 1 ? "count" : "counts"} into stock. A wrong count is corrected with a stock count, not by undoing this.`,
                keep: "Keep counting",
                go: "Post opening stock",
                fill: "action",
              },
            },
          },
        }
      : null,
  actions: (row) => (row.status === "DRAFT" ? [{ key: "count", label: "Count an item", requires: [COUNT], do: { sheet: "mill-opening-count" } }] : []),
  banner: (row) => (row.warnings.length ? { lead: "Books will not post every line.", text: row.warnings.join(" "), tone: "bad" } : null),
  steps: (row) => [
    { label: "Counting", state: row.status === "DRAFT" ? "now" : "done" },
    { label: "Posted", state: row.status === "POSTED" ? "done" : "todo" },
  ],
  chips: (row) => [row.status === "DRAFT" ? { label: "Counting", tone: "info" } : { label: "Posted", tone: "ok" }],
  figure: (row) => ({ label: "at cost", value: money(row.total) }),
  kpis: (row) => [
    { label: "Counts", value: String(row.lines.length), note: row.lines.length ? "items at their places" : "Nothing counted yet" },
    { label: "Places", value: String(new Set(row.lines.map((line) => line.stockLocationId)).size), note: "stores and bins" },
    { label: "As of", value: day(row.asOf), note: "the first day on the books" },
    { label: row.status === "POSTED" ? "Posted" : "Not posted", value: row.postedAt ? day(row.postedAt) : "—", note: row.status === "POSTED" ? "into stock and Books" : "Management posts it" },
  ],
  tabs: [{ key: "lines", label: "Counted", source: "milling-opening-lines", parent: "opening", parentId: (row) => row.id, emptyText: () => "Nothing counted yet. Count an item to start." }],
  rail: (row) => [
    {
      title: row.status === "POSTED" ? "Posted to Books" : "Will post to Books",
      rows: row.journal.length
        ? [
            ...row.journal.map((entry) => ({ key: entry.code, label: `${entry.code} ${entry.name}`, value: entry.debit ? `Dr ${money(entry.debit)}` : `Cr ${money(entry.credit)}`, mono: true })),
            { key: "balance", label: row.journalBalanced ? "Balances" : "Does not balance", value: money(row.journal.reduce((sum, entry) => sum + entry.debit, 0)), mono: true, ...(row.journalBalanced ? {} : { warn: "Debits and credits differ." }) },
          ]
        : [{ key: "none", label: "Counts with a cost show here as the journal they will post.", value: "", muted: true }],
    },
  ],
  invalidates: [["list"], ["reports"], ["milling"]],
};
