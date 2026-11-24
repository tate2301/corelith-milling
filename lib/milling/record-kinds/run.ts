import { fetchJson } from "@/lib/api-client";
import type { HistoryEntry } from "@/lib/milling/records/history";
import type { Grant, RecordAction, RecordKind } from "@/lib/retail/record-kinds/types";

import { historyRail } from "./shared";

type RouteStage = { id: string; code: string; name: string; required: boolean; capturesQuantities: boolean; equipment: Array<{ code: string; availability: string }> };

export type RunView = {
  batch: {
    id: string;
    code: string;
    status: string;
    shiftId: string | null;
    maizeIssuedKg: number;
    maizeCost: number;
    waterAddedKg: number;
    outputKg: number | null;
    separatedKg: number | null;
    inProcessChangeKg: number | null;
    unaccountedKg: number | null;
    variancePct: number | null;
    startedAt: string;
    completedAt: string | null;
  };
  order: { id: string; code: string } | null;
  route: RouteStage[];
  stages: Array<{ id: string; stageId: string }>;
  sources: Array<{ id: string }>;
  outputs: Array<{ id: string; quantityKg: number }>;
  exceptions: Array<{ id: string; code: string; title: string; status: string }>;
  downtime: Array<{ id: string; cause: string; endedAt: string | null }>;
  history: HistoryEntry[];
};

const RUN: Grant = ["ext:milling", "batch.run"];
const STAGE: Grant = ["ext:milling", "stage.record"];
const APPROVE: Grant = ["ext:milling", "batch.approve"];
const STATE: Record<string, { label: string; tone: "plain" | "info" | "warn" | "ok" }> = {
  OPEN: { label: "Started", tone: "plain" },
  IN_PROGRESS: { label: "Running", tone: "info" },
  AWAITING_DECISION: { label: "On hold", tone: "warn" },
  COMPLETED: { label: "Completed", tone: "ok" },
};

const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const kg = (value: number | null) => (value === null ? "—" : `${value.toLocaleString("en-GB", { maximumFractionDigits: 1 })} kg`);
const when = (value: string | null) => (value ? new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Harare", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

const done = (run: RunView, stageId: string) => run.stages.some((row) => row.stageId === stageId);
const nextStage = (run: RunView) => run.route.find((stage) => !done(run, stage.id));

function primary(run: RunView): RecordAction | null {
  const { batch } = run;
  if (batch.status === "COMPLETED") return null;
  if (!num(batch.maizeIssuedKg)) return { key: "issue", label: "Issue maize", requires: [RUN], do: { sheet: "mill-run-issue", id: batch.id } };
  const next = nextStage(run);
  const requiredLeft = run.route.some((stage) => stage.required && !done(run, stage.id));
  if (next && requiredLeft) return { key: "stage", label: `Record ${next.name.toLowerCase()}`, requires: [STAGE], do: { sheet: "mill-run-stage", id: batch.id, params: { stageId: next.id } } };
  return { key: "complete", label: "Complete the run", requires: [APPROVE], do: { sheet: "mill-run-complete", id: batch.id } };
}

/**
 * A run (canvas PR-A2) on core's RecordFrame: its route stage by stage in
 * the strip, maize in and product out, the material balance, and what is
 * holding it. The next stage to record is the primary.
 */
export const runKind: RecordKind<RunView> = {
  type: "MillingBatch",
  back: { label: "Runs", href: "/milling/production" },
  queryKey: (id) => ["milling-run", id],
  load: async (id) => {
    const [detail, history] = await Promise.all([
      fetchJson<Omit<RunView, "history">>(`/api/milling/batches/${id}`),
      fetchJson<HistoryEntry[]>(`/api/milling/history?entityType=MillingBatch&entityId=${id}`).catch(() => []),
    ]);
    return { ...detail, history };
  },
  title: (run) => (run.order ? `Run on ${run.order.code}` : "Run"),
  reference: (run) => run.batch.code,
  primary,
  actions: (run) =>
    run.batch.status === "COMPLETED"
      ? []
      : [
          ...(num(run.batch.maizeIssuedKg) ? [{ key: "issue", label: "Issue maize", requires: [RUN], do: { sheet: "mill-run-issue", id: run.batch.id } } satisfies RecordAction] : []),
          { key: "output", label: "Product out", requires: [STAGE], do: { sheet: "mill-run-output", id: run.batch.id } },
        ],
  more: (run) =>
    run.batch.status === "COMPLETED"
      ? []
      : run.route.map((stage) => ({ key: `stage-${stage.id}`, label: `${done(run, stage.id) ? "Record again" : "Record"}: ${stage.name}`, requires: [STAGE], do: { sheet: "mill-run-stage", id: run.batch.id, params: { stageId: stage.id } } })),
  banner: (run) => {
    const open = run.exceptions.filter((row) => row.status === "OPEN");
    if (open.length) return { lead: `${open[0]!.title}.`, text: "The run waits for management under Exceptions." };
    const stopped = run.downtime.find((row) => !row.endedAt);
    if (stopped) return { lead: "The line is stopped.", text: stopped.cause, tone: "bad" };
    return null;
  },
  steps: (run) => {
    const next = nextStage(run);
    return run.route.map((stage) => ({ label: stage.name, state: done(run, stage.id) ? "done" : stage.id === next?.id && run.batch.status !== "COMPLETED" ? "now" : "todo" }));
  },
  chips: (run) => [STATE[run.batch.status] ?? { label: run.batch.status, tone: "plain" }],
  figure: (run) => {
    const maize = num(run.batch.maizeIssuedKg) ?? 0;
    const out = num(run.batch.outputKg) ?? run.outputs.reduce((sum, row) => sum + Number(row.quantityKg), 0);
    return maize > 0 && out > 0 ? { label: "extraction", value: `${((out / maize) * 100).toFixed(1)}%` } : null;
  },
  kpis: (run) => {
    const maize = num(run.batch.maizeIssuedKg);
    const out = num(run.batch.outputKg) ?? run.outputs.reduce((sum, row) => sum + Number(row.quantityKg), 0);
    const variance = num(run.batch.variancePct);
    return [
      { label: "Maize in", value: kg(maize), note: `cost $${(num(run.batch.maizeCost) ?? 0).toFixed(2)}` },
      { label: "Product out", value: kg(out || null), note: `${run.outputs.length} ${run.outputs.length === 1 ? "lot" : "lots"} on hold for quality` },
      { label: "Water added", value: kg(num(run.batch.waterAddedKg)), note: "at conditioning" },
      { label: "Unaccounted", value: kg(num(run.batch.unaccountedKg)), ...(variance !== null ? { lead: `${variance.toFixed(1)}%`, leadTone: Math.abs(variance) > 2 ? ("warn" as const) : ("plain" as const) } : {}), note: variance === null ? "Worked out when it completes" : "of what went in" },
    ];
  },
  tabs: [
    { key: "stages", label: "Stages", source: "milling-run-stages", parent: "run" },
    { key: "maize", label: "Maize in", source: "milling-run-maize", parent: "run" },
    { key: "outputs", label: "Product out", source: "milling-run-outputs", parent: "run" },
  ],
  rail: (run) => [
    {
      title: "Run",
      rows: [
        { key: "plan", label: "Plan", value: run.order?.code ?? "None", mono: true, ...(run.order ? { links: [{ label: run.order.code, href: `/milling/plan/${run.order.id}` }] } : {}) },
        { key: "started", label: "Started", value: when(run.batch.startedAt), mono: true },
        { key: "completed", label: "Completed", value: when(run.batch.completedAt), mono: true },
      ],
    },
    {
      title: "Material balance",
      rows: [
        { key: "in", label: "Maize in", value: kg(num(run.batch.maizeIssuedKg)), mono: true },
        { key: "water", label: "Water added", value: kg(num(run.batch.waterAddedKg)), mono: true },
        { key: "out", label: "Product out", value: kg(num(run.batch.outputKg)), mono: true },
        { key: "separated", label: "Separated", value: kg(num(run.batch.separatedKg)), mono: true },
        { key: "change", label: "Change in the line", value: kg(num(run.batch.inProcessChangeKg)), mono: true },
        { key: "unaccounted", label: "Unaccounted", value: kg(num(run.batch.unaccountedKg)), mono: true },
      ],
    },
    historyRail(run.history),
  ],
  invalidates: [["list"], ["reports"], ["milling"]],
};
