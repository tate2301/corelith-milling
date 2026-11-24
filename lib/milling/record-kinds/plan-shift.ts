import { fetchJson } from "@/lib/api-client";
import type { HistoryEntry } from "@/lib/milling/records/history";
import type { Grant, RecordAction, RecordKind, RecordStep } from "@/lib/retail/record-kinds/types";

import { historyRail } from "./shared";

const kg = (value: number) => `${value.toLocaleString("en-GB", { maximumFractionDigits: 0 })} kg`;
const when = (value: string | null) => (value ? new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Harare", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const dayOf = (value: string) => new Date(value).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });

export type PlanView = {
  order: { id: string; code: string; status: string; productionDate: string; shiftKind: string; approvedShort: boolean; notes: string | null; lines: Array<{ id: string; productName: string; bags: number | null; kg: number }> };
  needs: { outputKg: number; maizeKg: number; maizeAvailableKg: number; packaging: Array<{ name: string; needed: number; available: number }>; short: string[] };
  reservedKg: number;
  batches: Array<{ id: string; code: string; status: string }>;
  history: HistoryEntry[];
};

const EDIT: Grant = ["ext:milling", "plan.edit"];
const APPROVE: Grant = ["ext:milling", "plan.approve"];
const PLAN_ORDER = ["DRAFT", "SUBMITTED", "APPROVED", "IN_PROGRESS", "COMPLETED", "CLOSED"];
const PLAN_STEP: Record<string, string> = { DRAFT: "Draft", SUBMITTED: "To approve", APPROVED: "Approved", IN_PROGRESS: "Running", COMPLETED: "Done", CLOSED: "Closed" };
const PLAN_TONE: Record<string, "plain" | "warn" | "info" | "ok"> = { DRAFT: "plain", SUBMITTED: "warn", APPROVED: "info", IN_PROGRESS: "info", COMPLETED: "ok", CLOSED: "ok", CANCELLED: "plain" };

function planPrimary({ order }: PlanView): RecordAction | null {
  switch (order.status) {
    case "DRAFT":
      return { key: "submit", label: "Submit for approval", requires: [EDIT], do: { post: { url: `/api/milling/orders/${order.id}/submit`, done: `${order.code} sent for approval`, ask: { title: `Submit ${order.code}?`, body: "Its maize and packaging are worked out, and management is asked to approve it.", keep: "Not yet", go: "Submit", fill: "action" } } } };
    case "SUBMITTED":
      return { key: "approve", label: "Approve", requires: [APPROVE], do: { sheet: "mill-plan-approve", id: order.id } };
    case "COMPLETED":
      return { key: "close", label: "Close the plan", requires: [EDIT], do: { post: { url: `/api/milling/orders/${order.id}/close`, done: `${order.code} closed` } } };
    default:
      return null;
  }
}

/** A production plan on core's RecordFrame: what the shift is to make, what it needs, approval, and the runs against it. */
export const planKind: RecordKind<PlanView> = {
  type: "MillingProductionOrder",
  back: { label: "Plan", href: "/milling/plan" },
  queryKey: (id) => ["milling-plan", id],
  load: async (id) => {
    const [detail, history] = await Promise.all([
      fetchJson<Omit<PlanView, "history">>(`/api/milling/orders/${id}`),
      fetchJson<HistoryEntry[]>(`/api/milling/history?entityType=MillingProductionOrder&entityId=${id}`).catch(() => []),
    ]);
    return { ...detail, history };
  },
  title: ({ order }) => `${dayOf(order.productionDate)}, ${order.shiftKind === "NIGHT" ? "night" : "day"} shift`,
  reference: ({ order }) => order.code,
  primary: planPrimary,
  actions: ({ order }) => (order.status === "SUBMITTED" ? [{ key: "back", label: "Send back", requires: [APPROVE], do: { sheet: "mill-plan-send-back", params: { ids: order.id } } }] : []),
  more: ({ order }) => (["DRAFT", "SUBMITTED", "APPROVED"].includes(order.status) ? [{ key: "cancel", label: "Cancel the plan", tone: "bad", requires: [EDIT], do: { sheet: "mill-plan-cancel", id: order.id } }] : []),
  banner: ({ order, needs }) =>
    needs.short.length && ["DRAFT", "SUBMITTED"].includes(order.status)
      ? { lead: "Materials are short.", text: `Short of ${needs.short.join("; ")}. Management can approve it anyway, with a reason.` }
      : order.approvedShort
        ? { lead: "Approved although short.", text: "The reason is on its history." }
        : null,
  steps: ({ order }) => {
    if (order.status === "CANCELLED") return [];
    const at = PLAN_ORDER.indexOf(order.status);
    return PLAN_ORDER.slice(0, 5).map((status, index): RecordStep => ({ label: PLAN_STEP[status]!, state: index < at ? "done" : index === at ? "now" : "todo" }));
  },
  chips: ({ order }) => [{ label: order.status === "CANCELLED" ? "Cancelled" : (PLAN_STEP[order.status] ?? order.status), tone: PLAN_TONE[order.status] ?? "plain" }],
  figure: ({ needs }) => ({ label: "of maize needed", value: kg(needs.maizeKg) }),
  kpis: ({ needs, reservedKg, batches }) => [
    { label: "To make", value: kg(needs.outputKg), note: "of product" },
    { label: "Maize free now", value: kg(needs.maizeAvailableKg), ...(needs.maizeAvailableKg < needs.maizeKg ? { lead: "Short", leadTone: "warn" as const } : {}), note: `against ${kg(needs.maizeKg)} needed` },
    { label: "Reserved", value: kg(reservedKg), note: "held for this plan" },
    { label: "Runs", value: String(batches.length), note: batches.length ? "against this plan" : "None started yet" },
  ],
  tabs: [
    { key: "lines", label: "To make", source: "milling-plan-lines", parent: "plan" },
    { key: "runs", label: "Runs", source: "milling-run-list", parent: "plan", filters: () => ({ date: "any", tab: "all" }), columns: ["code", "state", "maizeKg", "outputKg", "extraction", "started"] },
  ],
  rail: ({ needs, history }) => [
    {
      title: "Packaging",
      rows: needs.packaging.length
        ? needs.packaging.map((row) => ({ key: row.name, label: row.name, value: `${row.needed.toLocaleString("en-GB")} needed, ${row.available.toLocaleString("en-GB")} free`, mono: true, warn: row.available < row.needed ? "Short." : undefined }))
        : [{ key: "none", label: "None needed", value: "", muted: true }],
    },
    historyRail(history),
  ],
  invalidates: [["list"], ["reports"], ["milling"]],
};

export type ShiftView = {
  shift: {
    id: string;
    code: string;
    kind: string;
    status: string;
    scheduledStart: string;
    scheduledEnd: string;
    actualStart: string | null;
    actualEnd: string | null;
    materialInProcessKg: number | null;
    handoverNotes: string | null;
    assignments: Array<{ id: string; attendance: string; overtimeHours: number }>;
  };
  batches: Array<{ id: string; code: string; status: string }>;
  downtime: Array<{ id: string; cause: string; startedAt: string; endedAt: string | null }>;
  bagsPacked: number;
  history: HistoryEntry[];
};

const MANAGE: Grant = ["ext:milling", "shift.manage"];
const SIGN: Grant = ["ext:milling", "shift.approve"];
const SHIFT_ORDER = ["PLANNED", "OPEN", "CLOSED", "APPROVED"];
const SHIFT_STEP: Record<string, string> = { PLANNED: "Planned", OPEN: "Open", CLOSED: "Closed", APPROVED: "Approved" };

function shiftPrimary({ shift }: ShiftView): RecordAction | null {
  switch (shift.status) {
    case "PLANNED":
      return { key: "open", label: "Open the shift", requires: [MANAGE], do: { post: { url: `/api/milling/shifts/${shift.id}/open`, done: `${shift.code} open`, ask: { title: `Open ${shift.code}?`, body: "The crew's attendance is taken from now, and runs can be started on it.", keep: "Not yet", go: "Open the shift", fill: "action" } } } };
    case "OPEN":
      return { key: "close", label: "Close the shift", requires: [MANAGE], do: { sheet: "mill-shift-close", id: shift.id } };
    case "CLOSED":
      return { key: "approve", label: "Approve", requires: [SIGN], do: { post: { url: `/api/milling/shifts/${shift.id}/approve`, done: `${shift.code} approved. Attendance sent to People.`, ask: { title: `Approve ${shift.code}?`, body: "Its attendance and overtime go to People for the pay run.", keep: "Not yet", go: "Approve", fill: "action" } } } };
    default:
      return null;
  }
}

/** A shift on core's RecordFrame: the crew and their time, the runs on it, what stopped, and the handover. */
export const shiftKind: RecordKind<ShiftView> = {
  type: "MillingShift",
  back: { label: "Shifts", href: "/milling/shifts" },
  queryKey: (id) => ["milling-shift", id],
  load: async (id) => {
    const [detail, history] = await Promise.all([
      fetchJson<Omit<ShiftView, "history">>(`/api/milling/shifts/${id}`),
      fetchJson<HistoryEntry[]>(`/api/milling/history?entityType=MillingShift&entityId=${id}`).catch(() => []),
    ]);
    return { ...detail, history };
  },
  title: ({ shift }) => `${shift.kind === "NIGHT" ? "Night" : "Day"} shift, ${new Date(shift.scheduledStart).toLocaleDateString("en-GB", { timeZone: "Africa/Harare", weekday: "long", day: "numeric", month: "long" })}`,
  reference: ({ shift }) => shift.code,
  primary: shiftPrimary,
  banner: ({ downtime }) => {
    const stopped = downtime.find((row) => !row.endedAt);
    return stopped ? { lead: "The line is stopped.", text: stopped.cause, tone: "bad" } : null;
  },
  steps: ({ shift }) => {
    const at = SHIFT_ORDER.indexOf(shift.status);
    return SHIFT_ORDER.map((status, index): RecordStep => ({ label: SHIFT_STEP[status]!, state: index < at ? "done" : index === at ? "now" : "todo" }));
  },
  chips: ({ shift }) => [{ label: SHIFT_STEP[shift.status] ?? shift.status, tone: shift.status === "APPROVED" ? "ok" : shift.status === "CLOSED" ? "warn" : shift.status === "OPEN" ? "info" : "plain" }],
  figure: ({ shift }) => {
    const present = shift.assignments.filter((row) => ["PRESENT", "LATE"].includes(row.attendance)).length;
    return { label: "on the crew", value: `${present} of ${shift.assignments.length}` };
  },
  kpis: ({ shift, batches, bagsPacked, downtime }) => [
    { label: "Ran", value: `${when(shift.actualStart ?? shift.scheduledStart)}`, note: shift.actualEnd ? `to ${when(shift.actualEnd)}` : `planned to ${when(shift.scheduledEnd)}` },
    { label: "Overtime", value: `${shift.assignments.reduce((sum, row) => sum + Number(row.overtimeHours || 0), 0).toFixed(1)} h`, note: "across the crew" },
    { label: "Runs", value: String(batches.length), note: `${bagsPacked.toLocaleString("en-GB")} bags packed` },
    { label: "Stops", value: String(downtime.length), note: downtime.length ? "see the Downtime list" : "No stops" },
  ],
  tabs: [
    { key: "crew", label: "Crew", source: "milling-shift-crew", parent: "shift" },
    { key: "runs", label: "Runs", source: "milling-run-list", parent: "onShift", filters: () => ({ date: "any", tab: "all" }), columns: ["code", "state", "maizeKg", "outputKg", "extraction", "started"] },
  ],
  rail: ({ shift, history }) => [
    {
      title: "Handover",
      rows: [
        { key: "material", label: "Left in the line", value: shift.materialInProcessKg === null ? "Not recorded" : kg(Number(shift.materialInProcessKg)), mono: shift.materialInProcessKg !== null, muted: shift.materialInProcessKg === null },
        { key: "notes", label: "Notes", value: shift.handoverNotes ?? "None", muted: !shift.handoverNotes },
      ],
    },
    historyRail(history),
  ],
  invalidates: [["list"], ["reports"], ["milling"]],
};
