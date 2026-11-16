"use client";

import { useQuery } from "@tanstack/react-query";

import { StatusChip } from "@/components/ui/status-chip";
import { fetchJson } from "@/lib/api-client";

/** The mill's statuses in plain words, and the chip tone each one takes. */
const STATUS: Record<string, { label: string; tone: string }> = {
  AWAITING_QC: { label: "Awaiting QC", tone: "in_review" },
  HELD: { label: "Held", tone: "need_changes" },
  HOLD: { label: "On hold", tone: "need_changes" },
  ACCEPTED: { label: "Accepted", tone: "passing" },
  AVAILABLE: { label: "Available", tone: "passing" },
  REJECTED: { label: "Rejected", tone: "failing" },
  CANCELLED: { label: "Cancelled", tone: "inactive" },
  CONSUMED: { label: "Used up", tone: "inactive" },
  PASS: { label: "Passed", tone: "passing" },
  FAIL: { label: "Failed", tone: "failing" },
  INCOMPLETE: { label: "Incomplete", tone: "need_changes" },
  OPEN: { label: "Open", tone: "in_progress" },
  OPEN_EXCEPTION: { label: "Waiting for a decision", tone: "pending" },
  DECIDED: { label: "Decided", tone: "passing" },
  POSTED: { label: "Posted", tone: "passing" },
  AWAITING_DECISION: { label: "Waiting for a decision", tone: "in_review" },
  DISCARDED: { label: "Discarded", tone: "inactive" },
  PROVISIONAL: { label: "Provisional", tone: "need_changes" },
  VERIFIED: { label: "Verified", tone: "passing" },
  // Production (L3)
  DRAFT: { label: "Draft", tone: "pending" },
  SUBMITTED: { label: "Submitted", tone: "in_review" },
  APPROVED: { label: "Approved", tone: "passing" },
  IN_PROGRESS: { label: "In progress", tone: "in_progress" },
  COMPLETED: { label: "Completed", tone: "passing" },
  CLOSED: { label: "Closed", tone: "inactive" },
  PLANNED: { label: "Planned", tone: "pending" },
  TO_DO: { label: "To do", tone: "pending" },
  OPTIONAL: { label: "Optional", tone: "inactive" },
  AWAITING_QC_RELEASE: { label: "Awaiting QC", tone: "in_review" },
  // Distribution (L4)
  LOADING: { label: "Loading", tone: "in_progress" },
  DISPATCHED: { label: "On the road", tone: "in_progress" },
  DELIVERED: { label: "Awaiting reconciliation", tone: "in_review" },
  CONFIRMED: { label: "Confirmed", tone: "passing" },
};

export function millStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return STATUS[status]?.label ?? status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
}

export function MillStatus({ status }: { status: string | null | undefined }) {
  return <StatusChip status={STATUS[status ?? ""]?.tone ?? "pending"} label={millStatusLabel(status)} />;
}

const KG = new Intl.NumberFormat("en-ZW", { maximumFractionDigits: 1 });
const TONNES = new Intl.NumberFormat("en-ZW", { maximumFractionDigits: 2 });
const QTY = new Intl.NumberFormat("en-ZW", { maximumFractionDigits: 3 });

/** 950 kg, or 19.95 t once it is a tonne or more. */
export function formatKg(kg: number | null | undefined): string {
  if (kg === null || kg === undefined || Number.isNaN(kg)) return "—";
  return Math.abs(kg) >= 1000 ? `${TONNES.format(kg / 1000)} t` : `${KG.format(kg)} kg`;
}

export const UNIT_SHORT: Record<string, string> = { KILOGRAM: "kg", TONNE: "t", BAG: "bags", EACH: "each", LITRE: "L" };

export function formatQty(quantity: number | null | undefined, unit?: string | null, unitLabel?: string | null): string {
  if (quantity === null || quantity === undefined) return "—";
  if (unit === "KILOGRAM") return formatKg(quantity);
  const word = unit === "OTHER" ? unitLabel ?? "" : UNIT_SHORT[unit ?? ""] ?? "";
  return `${QTY.format(quantity)}${word ? ` ${word}` : ""}`;
}

export function formatWhen(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-ZW", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export interface MillLookups {
  site: { id: string; name: string } | null;
  products: Array<{ id: string; code: string | null; name: string; unit: string; unitLabel: string | null; category: string | null; netWeightKg: number | null; standardPrice: number }>;
  locations: Array<{ id: string; code: string; name: string; kind: string; capacityKg: number | null }>;
  vendors: Array<{ id: string; name: string }>;
  specs: Array<{ id: string; point: string; code: string; name: string; method: string; resultType: string; unit: string | null; minValue: number | null; maxValue: number | null; guidance: string | null; required: boolean; version: number }>;
  defaultIntakeBagKg: number;
  customers: Array<{ id: string; name: string }>;
  destinations: Array<{ id: string; name: string }>;
  vehicles: Array<{ id: string; equipmentCode: string; name: string; registrationNumber: string | null; capacityKg: number | null; driverUserId: string | null }>;
}

export function useMillLookups() {
  return useQuery({ queryKey: ["milling", "lookups"], queryFn: () => fetchJson<MillLookups>("/api/milling/lookups"), staleTime: 60_000 });
}

export { MillSelect } from "./mill-select";
