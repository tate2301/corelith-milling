"use client";

import { StatusChip } from "@/components/ui/status-chip";

export type CustomerStateKey = "OVER_LIMIT" | "OVERDUE" | "CURRENT";

/** $1,420.00, or a dash for nothing known. */
export const money = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `$${value.toLocaleString("en-ZW", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATE: Record<CustomerStateKey, { label: string; tone: string }> = {
  CURRENT: { label: "Current", tone: "passing" },
  OVERDUE: { label: "Overdue", tone: "need_changes" },
  OVER_LIMIT: { label: "Over limit", tone: "failing" },
};

/** A customer's state as the canvas names it: current, overdue, or over their limit. */
export function CustomerState({ state }: { state: CustomerStateKey }) {
  return <StatusChip status={STATE[state].tone} label={STATE[state].label} />;
}
