"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";

import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson } from "@/lib/api-client";
import type { HistoryEntry } from "@/lib/milling/records/history";

const value = (raw: unknown) => (raw === null || raw === undefined || raw === "" ? "empty" : String(raw));

function describe(entry: HistoryEntry) {
  if (entry.kind === "amendment") return `Corrected ${entry.what}: ${value(entry.from)} → ${value(entry.to)}`;
  const action = entry.what.split(".").at(-1) ?? entry.what;
  return action.charAt(0).toUpperCase() + action.slice(1).replace(/-/g, " ");
}

/** The History tab every mill record has: what happened to it, who did it, and every correction with its reason. */
export function RecordHistory({ entityType, entityId }: { entityType: string; entityId: string }) {
  const query = useQuery({
    queryKey: ["milling", "history", entityType, entityId],
    queryFn: () =>
      fetchJson<HistoryEntry[]>(
        `/api/milling/history?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
      ),
  });
  if (query.isPending) return <Skeleton className="h-32 w-full" />;
  const entries = query.data ?? [];
  if (!entries.length) return <EmptyState title="Nothing has happened to this record yet" body="Approvals, corrections and changes appear here." />;
  return (
    <ol className="space-y-3">
      {entries.map((entry, index) => (
        <li key={`${entry.at}-${index}`} className="border-l-2 border-border pl-3 text-sm">
          <div className="font-medium">{describe(entry)}</div>
          <div className="text-xs text-muted-foreground">
            {new Date(entry.at).toLocaleString()}
            {entry.who ? ` · ${entry.who}` : ""}
            {entry.reason ? ` · “${entry.reason}”` : ""}
          </div>
        </li>
      ))}
    </ol>
  );
}
