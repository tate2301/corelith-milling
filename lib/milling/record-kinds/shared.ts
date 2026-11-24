import type { HistoryEntry } from "@/lib/milling/records/history";
import type { RailGroup } from "@/lib/retail/record-kinds/types";

const value = (raw: unknown) => (raw === null || raw === undefined || raw === "" ? "empty" : String(raw));

/** What happened, in words: "Closed", or "Corrected net kg: 19,950 → 19,800". */
export function describe(entry: HistoryEntry): string {
  if (entry.kind === "amendment") return `Corrected ${entry.what}: ${value(entry.from)} → ${value(entry.to)}`;
  const action = entry.what.split(".").at(-1) ?? entry.what;
  return action.charAt(0).toUpperCase() + action.slice(1).replace(/-/g, " ");
}

const at = (value: string) => new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Harare", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * A mill record's history (canvas DS-A2's rail): who did what and when, and
 * every correction with its old and new values, newest first. Mill records
 * keep their own audit chain, so it is drawn in the rail.
 */
export function historyRail(entries: HistoryEntry[], limit = 8): RailGroup {
  return {
    title: "History",
    rows: entries.length
      ? entries.slice(0, limit).map((entry, index) => ({
          key: `history-${index}`,
          label: at(entry.at),
          value: `${entry.who ? `${entry.who}: ` : ""}${describe(entry).toLowerCase().replace(/^corrected/, "corrected")}${entry.reason ? `, “${entry.reason}”` : ""}`,
        }))
      : [{ key: "history-none", label: "Nothing yet", value: "", muted: true }],
  };
}
