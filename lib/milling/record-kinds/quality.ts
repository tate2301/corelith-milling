import { fetchJson } from "@/lib/api-client";
import type { HistoryEntry } from "@/lib/milling/records/history";
import type { Grant, RecordAction, RecordKind, RecordStep } from "@/lib/retail/record-kinds/types";

import { historyRail } from "./shared";

const kg = (value: number) => `${value.toLocaleString("en-GB", { maximumFractionDigits: 1 })} kg`;
const usd = (value: number) => "$" + value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (value: string) => new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Harare", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const WEIGHED_BY: Record<string, string> = { BAG_COUNT: "Bag count", EXTERNAL_TICKET: "Weighbridge ticket", SUPPLIER_DECLARED: "Supplier's weight" };
const INTAKE_STATE: Record<string, { label: string; tone: "plain" | "warn" | "ok" | "bad" | "info" }> = {
  AWAITING_QC: { label: "Awaiting QC", tone: "info" },
  HELD: { label: "Held", tone: "warn" },
  ACCEPTED: { label: "Accepted", tone: "ok" },
  REJECTED: { label: "Rejected", tone: "bad" },
  CANCELLED: { label: "Cancelled", tone: "plain" },
};

export type IntakeView = {
  intake: {
    id: string;
    code: string;
    status: string;
    supplierName: string;
    vehicleReg: string | null;
    driverName: string | null;
    deliveryRef: string | null;
    variety: string | null;
    weighMethod: string;
    bags: number | null;
    bagKg: number | null;
    grossKg: number | null;
    tareKg: number | null;
    netKg: number;
    ticketNumber: string | null;
    weightStatus: string;
    receivedAt: string;
    decisionNote: string | null;
    pricePerTonne: number | null;
    billId: string | null;
  };
  bill: { id: string; billNumber: string | null; status: string } | null;
  productName: string | null;
  bin: { code: string; name: string } | null;
  lot: { id: string; code: string; status: string; onHand: number } | null;
  inspections: Array<{ id: string; outcome: string; inspectedAt: string }>;
  exceptions: Array<{ id: string; code: string; title: string; status: string }>;
  history: HistoryEntry[];
};

const RECORD: Grant = ["ext:milling", "intake.record"];
const QC: Grant = ["ext:milling", "qc.record"];
const DECIDE: Grant = ["ext:milling", "qc.decide"];

function intakeSteps({ intake, inspections }: IntakeView): RecordStep[] {
  const decided = ["ACCEPTED", "REJECTED"].includes(intake.status);
  return [
    { label: "Weighed", state: "done" },
    { label: "Tested", state: inspections.length ? "done" : "now" },
    { label: intake.status === "REJECTED" ? "Rejected" : "Accepted", state: decided ? "done" : inspections.length ? "now" : "todo" },
    { label: "Billed", state: intake.billId ? "done" : intake.status === "ACCEPTED" ? "now" : "todo" },
  ];
}

function intakePrimary(view: IntakeView): RecordAction | null {
  const { intake } = view;
  const params = { code: intake.code };
  if (intake.status === "AWAITING_QC" && !view.inspections.length) return { key: "inspect", label: "Take the sample", requires: [QC], do: { sheet: "mill-intake-inspect", id: intake.id, params } };
  if (["AWAITING_QC", "HELD"].includes(intake.status)) return { key: "decide", label: "Decide", requires: [DECIDE], do: { sheet: "mill-intake-decide", id: intake.id, params } };
  if (intake.status === "ACCEPTED" && !intake.billId) return { key: "bill", label: "Bill the supplier", requires: [RECORD], do: { sheet: "mill-intake-bill", id: intake.id, params: { ...params, price: intake.pricePerTonne ? String(intake.pricePerTonne) : "" } } };
  return null;
}

/**
 * A weighbridge ticket (canvas IN-C1) on core's RecordFrame: the truck and
 * supplier, the weights and how they were taken, the test against the spec,
 * the decision, and the bill in Books. What comes next is the primary.
 */
export const intakeKind: RecordKind<IntakeView> = {
  type: "MillingIntake",
  back: { label: "Intake", href: "/milling/intake" },
  queryKey: (id) => ["milling-intake", id],
  load: async (id) => {
    const [detail, history] = await Promise.all([
      fetchJson<Omit<IntakeView, "history">>(`/api/milling/intakes/${id}`),
      fetchJson<HistoryEntry[]>(`/api/milling/history?entityType=MillingIntake&entityId=${id}`).catch(() => []),
    ]);
    return { ...detail, history };
  },
  title: ({ intake }) => intake.supplierName,
  reference: ({ intake }) => intake.code,
  primary: intakePrimary,
  actions: ({ intake, inspections }) => [
    ...(intake.weightStatus === "PROVISIONAL" && intake.status !== "CANCELLED" ? [{ key: "weight", label: "Confirm the weight", requires: [RECORD], do: { sheet: "mill-intake-weight", id: intake.id, params: { code: intake.code } } } satisfies RecordAction] : []),
    ...(inspections.length && ["AWAITING_QC", "HELD"].includes(intake.status) ? [{ key: "retest", label: "Test again", requires: [QC], do: { sheet: "mill-intake-inspect", id: intake.id, params: { code: intake.code } } } satisfies RecordAction] : []),
  ],
  banner: ({ exceptions, intake }) => {
    const open = exceptions.filter((row) => row.status === "OPEN");
    if (open.length) return { lead: `${open[0]!.title}.`, text: "It waits for management under Exceptions." };
    if (intake.status === "REJECTED") return { lead: "Rejected.", text: intake.decisionNote ?? "The maize went back to the supplier.", tone: "bad" };
    return null;
  },
  steps: (view) => (view.intake.status === "CANCELLED" ? [] : intakeSteps(view)),
  chips: ({ intake }) => [INTAKE_STATE[intake.status] ?? { label: intake.status, tone: "plain" }, { label: intake.weightStatus === "VERIFIED" ? "Weight verified" : "Weight provisional", tone: intake.weightStatus === "VERIFIED" ? "ok" : "warn" }],
  figure: ({ intake }) => ({ label: "payable", value: kg(intake.netKg) }),
  kpis: ({ intake, lot }) => [
    {
      label: "Weights",
      value: intake.grossKg !== null && intake.tareKg !== null ? `${kg(intake.grossKg)} less ${kg(intake.tareKg)}` : intake.bags ? `${intake.bags} bags × ${intake.bagKg ?? "?"} kg` : kg(intake.netKg),
      note: WEIGHED_BY[intake.weighMethod] ?? intake.weighMethod,
    },
    { label: "Value", value: intake.pricePerTonne ? usd((intake.netKg / 1000) * intake.pricePerTonne) : "—", note: intake.pricePerTonne ? `at ${usd(intake.pricePerTonne)} a tonne` : "No price agreed yet" },
    { label: "Lot", value: lot?.code ?? "—", note: lot ? `${kg(lot.onHand)} on hand` : "Made when it is accepted" },
    { label: "Received", value: when(intake.receivedAt), note: intake.ticketNumber ? `ticket ${intake.ticketNumber}` : "No ticket yet" },
  ],
  tabs: [{ key: "results", label: "Test results", source: "milling-qc-results", parent: "intake" }],
  rail: (view) => [
    {
      title: "Delivery",
      rows: [
        { key: "grain", label: "Grain", value: `${view.productName ?? "—"}${view.intake.variety ? `, ${view.intake.variety}` : ""}` },
        { key: "truck", label: "Truck", value: view.intake.vehicleReg ?? "—", mono: true },
        { key: "driver", label: "Driver", value: view.intake.driverName ?? "—", muted: !view.intake.driverName },
        { key: "note", label: "Their note", value: view.intake.deliveryRef ?? "—", mono: true },
        { key: "bin", label: "Into", value: view.bin ? `${view.bin.code} · ${view.bin.name}` : "Not yet", muted: !view.bin },
      ],
    },
    {
      title: "Books",
      rows: [
        view.bill
          ? { key: "bill", label: "Bill", value: view.bill.billNumber ?? "Draft", mono: true, links: [{ label: view.bill.billNumber ?? "Draft bill", href: `/books/bills/${view.bill.id}` }] }
          : { key: "bill", label: "Bill", value: "Not billed yet", muted: true },
      ],
    },
    historyRail(view.history),
  ],
  invalidates: [["list"], ["reports"], ["milling"]],
};

export type LotView = {
  id: string;
  code: string;
  status: string;
  originType: string;
  producedAt: string;
  product: string;
  quantity: number;
  lastInspection: { outcome: string; inspectedAt: string } | null;
  waiting: string[];
  history: HistoryEntry[];
};

const LOT_STATE: Record<string, { label: string; tone: "plain" | "warn" | "ok" | "bad" }> = {
  HOLD: { label: "On hold", tone: "warn" },
  AVAILABLE: { label: "Released", tone: "ok" },
  REJECTED: { label: "Rejected", tone: "bad" },
  CONSUMED: { label: "Used", tone: "plain" },
};
const ORIGIN: Record<string, string> = { BATCH: "A run", INTAKE: "Intake", RETURN: "A return", PACK: "Packing", OPENING: "Opening stock" };

/** A lot's tests (canvas QT-A2) on core's RecordFrame: what it holds, its results against the spec, and the decision. */
export const lotKind: RecordKind<LotView> = {
  type: "MillingLot",
  back: { label: "Quality", href: "/milling/quality" },
  queryKey: (id) => ["milling-lot", id],
  load: async (id) => {
    const [rows, history] = await Promise.all([
      fetchJson<Array<Omit<LotView, "history">>>(`/api/milling/lots?id=${id}`),
      fetchJson<HistoryEntry[]>(`/api/milling/history?entityType=MillingLot&entityId=${id}`).catch(() => []),
    ]);
    if (!rows[0]) throw new Error("That lot is not here.");
    return { ...rows[0], history };
  },
  title: (lot) => lot.product,
  reference: (lot) => lot.code,
  primary: (lot) =>
    lot.status === "HOLD" && !lot.lastInspection
      ? { key: "inspect", label: "Take the sample", requires: [QC], do: { sheet: "mill-lot-inspect", id: lot.id, params: { code: lot.code } } }
      : ["HOLD", "AVAILABLE"].includes(lot.status)
        ? { key: "decide", label: lot.status === "HOLD" ? "Decide" : "Hold or reject", requires: [DECIDE], do: { sheet: "mill-lot-decide", id: lot.id, params: { code: lot.code } } }
        : null,
  actions: (lot) => (lot.lastInspection && ["HOLD", "AVAILABLE"].includes(lot.status) ? [{ key: "retest", label: "Test again", requires: [QC], do: { sheet: "mill-lot-inspect", id: lot.id, params: { code: lot.code } } }] : []),
  more: (lot) => [{ key: "trace", label: "Trace this lot", requires: [], do: { href: `/milling/trace?code=${encodeURIComponent(lot.code)}` } }],
  banner: (lot) => (lot.waiting.length ? { lead: `Waiting on ${lot.waiting.join(", ")}.`, text: "Management decides it under Exceptions." } : null),
  chips: (lot) => [LOT_STATE[lot.status] ?? { label: lot.status, tone: "plain" }],
  figure: (lot) => ({ label: "holds", value: kg(lot.quantity) }),
  kpis: (lot) => [
    { label: "From", value: ORIGIN[lot.originType] ?? lot.originType, note: when(lot.producedAt) },
    { label: "Last test", value: lot.lastInspection ? (lot.lastInspection.outcome === "PASS" ? "Passed" : lot.lastInspection.outcome === "FAIL" ? "Failed" : "Incomplete") : "Not tested", note: lot.lastInspection ? when(lot.lastInspection.inspectedAt) : "Take the sample" },
    { label: "Holds", value: kg(lot.quantity), note: "across its places" },
  ],
  tabs: [{ key: "results", label: "Test results", source: "milling-qc-results", parent: "lot" }],
  rail: (lot) => [historyRail(lot.history)],
  invalidates: [["list"], ["reports"], ["milling"]],
};
