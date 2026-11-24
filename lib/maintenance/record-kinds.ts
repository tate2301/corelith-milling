import { fetchJson } from "@/lib/api-client";
import type { EquipmentRecord } from "@/lib/maintenance/equipment-record";
import type { WorkOrderRecord } from "@/lib/maintenance/work-order-record";
import type { Grant, RecordAction, RecordKind, RecordStep } from "@/lib/retail/record-kinds/types";

/**
 * The Assets records on core's RecordFrame, as Stock's and Books' are: a
 * machine or vehicle (its work, its plans, its fuel), and a work order (from
 * Vane's draft or a breakdown or a plan, to done).
 */

const ZONE = "Africa/Harare";
const EQUIPMENT_EDIT: Grant = ["maintenance.equipment", "update"];
const ORDERS_EDIT: Grant = ["maintenance.work-orders", "update"];
const BREAKDOWN: Grant = ["maintenance.breakdowns", "create"];
const PLANS_EDIT: Grant = ["maintenance.schedule", "update"];
const UNIT = { NONE: "", HOURS: "h", KM: "km" } as const;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: ZONE, day: "numeric", month: "short", year: "numeric" }) : "—");
const dayTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: ZONE, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const usd = (value: number) => `US$${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const title = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ");

export const equipmentKind: RecordKind<EquipmentRecord> = {
  type: "Equipment",
  back: { label: "Machinery and vehicles", href: "/maintenance/equipment" },
  queryKey: (id) => ["maintenance", "equipment", id],
  load: (id) => fetchJson<EquipmentRecord>(`/api/maintenance/equipment/${id}`),
  title: (row) => row.name,
  reference: (row) => row.code,
  primary: (row) => (row.isActive ? { key: "breakdown", label: "Log a breakdown", requires: [BREAKDOWN], do: { sheet: "maint-breakdown", params: { equipment: row.id } } } : null),
  actions: (row) => [
    ...(row.meterType !== "NONE" ? [{ key: "meter", label: "Read the meter", requires: [EQUIPMENT_EDIT], do: { sheet: "maint-meter", id: row.id } } satisfies RecordAction] : []),
    { key: "plan", label: "Add a plan", requires: [PLANS_EDIT], do: { sheet: "maint-plan", params: { equipment: row.id } } },
  ],
  more: (row): RecordAction[] => [
    { key: "edit", label: "Change the details", requires: [EQUIPMENT_EDIT], do: { sheet: "maint-equipment", id: row.id } },
    row.isActive
      ? { key: "retire", label: "Retire it", tone: "bad", requires: [EQUIPMENT_EDIT], do: { post: { url: `/api/equipment/${row.id}`, method: "PATCH", body: { isActive: false }, done: `${row.name} retired`, ask: { title: `Retire ${row.name}?`, body: "It leaves the register's working tabs and takes no more work orders or plans. Its history stays.", keep: "Keep it", go: "Retire it", fill: "bad" } } } }
      : { key: "return", label: "Back into use", requires: [EQUIPMENT_EDIT], do: { post: { url: `/api/equipment/${row.id}`, method: "PATCH", body: { isActive: true }, done: `${row.name} is back in use` } } },
  ],
  banner: (row) => (row.state === "DOWN" ? { lead: "Down.", text: "A breakdown is open on it. It is back at work when its work order is done.", tone: "bad" } : null),
  chips: (row) => [
    { label: row.kind === "VEHICLE" ? "Vehicle" : "Machinery", tone: "plain" },
    row.state === "RETIRED" ? { label: "Retired", tone: "plain" } : row.state === "DOWN" ? { label: "Down", tone: "bad" } : { label: "Working", tone: "ok" },
  ],
  figure: (row) => (row.currentMeter === null ? null : { label: row.meterType === "KM" ? "on the clock" : "engine hours", value: `${row.currentMeter.toLocaleString("en-GB")} ${UNIT[row.meterType]}` }),
  kpis: (row) => [
    { label: "Down", value: `${row.month.downHours.toLocaleString("en-GB")} h`, note: "in the last 30 days" },
    { label: "Work cost", value: usd(row.month.cost), note: "parts and labour, 30 days" },
    { label: "Fuel", value: `${row.month.litres.toLocaleString("en-GB")} L`, note: row.month.rate === null ? "in the last 30 days" : row.meterType === "KM" ? `${row.month.rate} L/100 km` : `${row.month.rate} L an hour` },
    { label: "Next service", value: row.nextService?.at ? day(row.nextService.at) : row.nextService?.meter ? `At ${row.nextService.meter.toLocaleString("en-GB")} ${UNIT[row.meterType]}` : "None planned", note: row.nextService?.name ?? "Add a plan to keep it serviced" },
  ],
  tabs: [
    { key: "work", label: "Work orders", source: "assets-work-orders", parent: "equipment", filters: () => ({ tab: "all", date: "any" }), columns: ["ref", "issue", "kind", "state", "technician", "when", "downHours", "cost"] },
    { key: "plans", label: "Plans", source: "assets-plans", parent: "equipment", filters: () => ({ tab: "all" }), columns: ["name", "every", "lastDone", "nextDue", "state"] },
    { key: "fuel", label: "Fuel", source: "assets-fuel-log", parent: "equipment", filters: () => ({ date: "any" }), columns: ["when", "fuel", "litres", "meter", "cost", "by"] },
    { key: "activity", label: "Activity" },
  ],
  rail: (row) => [
    {
      title: "What it is",
      rows: [
        { key: "category", label: "Kind", value: title(row.category) },
        { key: "make", label: "Make and model", value: [row.make, row.model].filter(Boolean).join(" ") || "—", muted: !row.make && !row.model },
        { key: "serial", label: "Serial", value: row.serialNumber ?? "—", mono: true, muted: !row.serialNumber },
        ...(row.kind === "VEHICLE" ? [{ key: "plate", label: "Number plate", value: row.registrationNumber ?? "—", mono: true, muted: !row.registrationNumber }] : []),
        { key: "since", label: "In use since", value: day(row.commissionedAt), muted: !row.commissionedAt },
      ],
    },
    {
      title: "Where",
      rows: [
        { key: "site", label: "Site", value: row.site },
        { key: "location", label: "Place", value: row.location },
      ],
    },
    {
      title: "Meter",
      rows:
        row.meterType === "NONE"
          ? [{ key: "none", label: "No meter", value: "", muted: true }]
          : [
              { key: "reading", label: row.meterType === "KM" ? "Kilometres" : "Engine hours", value: row.currentMeter === null ? "Not read yet" : row.currentMeter.toLocaleString("en-GB"), mono: true, muted: row.currentMeter === null },
              { key: "read", label: "Read", value: dayTime(row.meterReadAt), muted: !row.meterReadAt },
              { key: "moved", label: "Last 30 days", value: `${row.month.moved.toLocaleString("en-GB")} ${UNIT[row.meterType]}`, mono: true },
            ],
    },
  ],
  invalidates: [["list"], ["maintenance"]],
};

const STEP_ORDER = ["OPEN", "IN_PROGRESS", "COMPLETED"] as const;
const STEP: Record<string, string> = { OPEN: "Open", IN_PROGRESS: "In progress", COMPLETED: "Done" };
const PRIORITY: Record<string, string> = { NORMAL: "Normal", HIGH: "High", URGENT: "Urgent" };

function orderPrimary(row: WorkOrderRecord): RecordAction | null {
  switch (row.status) {
    case "DRAFT":
      return { key: "raise", label: "Raise the work order", requires: [ORDERS_EDIT], do: { post: { url: `/api/work-orders/${row.id}/raise`, done: "Raised. The workshop has been told.", ask: { title: "Raise Vane's work order?", body: "It opens for the workshop, and whoever is on it is told.", keep: "Not yet", go: "Raise it", fill: "action" } } } };
    case "OPEN":
      return { key: "start", label: "Start the work", requires: [ORDERS_EDIT], do: { post: { url: `/api/work-orders/${row.id}`, method: "PATCH", body: { status: "IN_PROGRESS" }, done: "Work started" } } };
    case "IN_PROGRESS":
      return { key: "complete", label: "Complete", requires: [ORDERS_EDIT], do: { sheet: "maint-complete", id: row.id } };
    default:
      return null;
  }
}

export const workOrderKind: RecordKind<WorkOrderRecord> = {
  type: "WorkOrder",
  back: { label: "Work orders", href: "/maintenance/work-orders" },
  queryKey: (id) => ["work-order", id],
  load: (id) => fetchJson<WorkOrderRecord>(`/api/work-orders/${id}`),
  title: (row) => row.issue.split("\n")[0] ?? "Work order",
  reference: (row) => `WO-${row.id.slice(0, 6).toUpperCase()}`,
  primary: orderPrimary,
  actions: (row) => (row.status === "OPEN" ? [{ key: "complete", label: "Complete", requires: [ORDERS_EDIT], do: { sheet: "maint-complete", id: row.id } }] : []),
  more: (row) => [
    ...(row.status === "DRAFT" && row.madeByVane
      ? [{ key: "delete", label: "Delete the draft", tone: "bad", requires: [ORDERS_EDIT], do: { post: { url: `/api/work-orders/${row.id}`, method: "DELETE", done: "Draft deleted", ask: { title: "Delete Vane's draft?", body: "Nobody was told of it. It goes for good.", keep: "Keep it", go: "Delete it", fill: "bad" } } } } satisfies RecordAction]
      : []),
    ...(row.status === "OPEN" || row.status === "IN_PROGRESS"
      ? [{ key: "cancel", label: "Cancel the work order", tone: "bad", requires: [ORDERS_EDIT], do: { post: { url: `/api/work-orders/${row.id}`, method: "PATCH", body: { status: "CANCELLED" }, done: "Work order cancelled", ask: { title: "Cancel the work order?", body: "It stays in the history as cancelled. A service's plan is not moved on.", keep: "Keep it", go: "Cancel it", fill: "bad" } } } } satisfies RecordAction]
      : []),
  ],
  banner: (row) => (row.madeByVane && row.status === "DRAFT" ? { lead: "Vane's draft.", text: row.note ?? "Raise it to send it to the workshop; nobody is told until you do." } : null),
  steps: (row) => {
    if (row.status === "DRAFT" || row.status === "CANCELLED") return [];
    const at = STEP_ORDER.indexOf(row.status as (typeof STEP_ORDER)[number]);
    return STEP_ORDER.map((status, index): RecordStep => ({ label: STEP[status]!, state: index < at ? "done" : index === at ? (status === "COMPLETED" ? "done" : "now") : "todo" }));
  },
  chips: (row) => [
    row.kind === "PREVENTIVE" ? { label: "Service", tone: "info" } : { label: "Breakdown", tone: "bad" },
    ...(row.status === "CANCELLED" ? [{ label: "Cancelled", tone: "plain" as const }] : row.status === "DRAFT" ? [{ label: "Draft", tone: "plain" as const }] : []),
    ...(row.priority !== "NORMAL" ? [{ label: PRIORITY[row.priority] ?? row.priority, tone: "warn" as const }] : []),
  ],
  figure: (row) => (row.partsCost + row.laborCost > 0 ? { label: "parts and labour", value: usd(row.partsCost + row.laborCost) } : null),
  kpis: (row) => {
    const end = row.endedAt ? new Date(row.endedAt).getTime() : Date.now();
    const hours = Math.max(0, Math.round(((end - new Date(row.startedAt).getTime()) / 3_600_000) * 10) / 10);
    return [
      row.kind === "PREVENTIVE"
        ? { label: "Booked for", value: day(row.scheduledFor), note: row.plan ? row.plan.name : "A service" }
        : { label: "Down", value: `${hours.toLocaleString("en-GB")} h`, note: row.endedAt ? `back ${dayTime(row.endedAt)}` : `since ${dayTime(row.startedAt)}` },
      { label: "Parts", value: usd(row.partsCost), note: row.parts.length ? `${row.parts.length} on the list` : "none listed" },
      { label: "Labour", value: usd(row.laborCost), note: row.technician ? row.technician.name : "nobody on it yet" },
      { label: "Meter", value: row.meter.type === "NONE" ? "—" : row.meter.atService !== null ? row.meter.atService.toLocaleString("en-GB") : (row.meter.current?.toLocaleString("en-GB") ?? "—"), note: row.meter.type === "NONE" ? "no meter" : row.meter.atService !== null ? "when the work was done" : "now" },
    ];
  },
  tabs: [
    { key: "earlier", label: "Earlier work", source: "assets-work-orders", parent: "equipment", parentId: (row) => row.equipment.id, filters: () => ({ tab: "all", date: "any" }), columns: ["ref", "issue", "kind", "state", "when", "downHours", "cost"] },
    { key: "activity", label: "Activity" },
  ],
  rail: (row) => [
    {
      title: "The work",
      rows: [
        { key: "equipment", label: "Machine or vehicle", value: "", links: [{ label: row.equipment.label, href: `/maintenance/equipment/${row.equipment.id}` }] },
        { key: "site", label: "Site", value: row.equipment.site },
        { key: "technician", label: "Who is on it", value: row.technician?.name ?? "Nobody yet", muted: !row.technician },
        { key: "priority", label: "Priority", value: PRIORITY[row.priority] ?? row.priority },
        ...(row.plan ? [{ key: "plan", label: "Plan", value: "", links: [{ label: row.plan.name, href: `/maintenance/schedule?sheet=maint-plan&id=${row.plan.id}` }] }] : []),
        { key: "raised", label: "Raised by", value: row.madeBy },
      ],
    },
    ...(row.issue.includes("\n") ? [{ title: "Checklist", rows: row.issue.split("\n").slice(1).filter(Boolean).map((task, index) => ({ key: `task${index}`, label: task, value: "" })) }] : []),
    ...(row.workDone ? [{ title: "Done", rows: [{ key: "done", label: row.workDone, value: "" }] }] : []),
    {
      title: "Parts",
      rows: row.parts.length
        ? row.parts.map((part, index) => ({ key: `part${index}`, label: part.name, value: `${part.needed}${part.unit ? ` ${part.unit}` : ""}`, mono: true, ...(part.onHand !== null && part.onHand < part.needed ? { warn: `Stores hold ${part.onHand}.` } : {}) }))
        : [{ key: "none", label: "None listed", value: "", muted: true }],
    },
  ],
  invalidates: [["list"], ["maintenance"], ["work-order"]],
};
