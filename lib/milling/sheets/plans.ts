import { z } from "zod";

import type { MillLookups } from "@/components/milling/mill-ui";
import { fetchJson } from "@/lib/api-client";
import type { SheetKind, SheetValues } from "@/lib/workspace/sheet-kind";

import { idOf, labels, numberOf, text, type Choice } from "./choices";
import { slotFields, slotItems, type Slot } from "./slots";

const PRODUCT_SLOTS = 16;
const CREW_SLOTS = 40;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const whole = z.string().regex(/^\d+$/, "A whole number.");

/** Plan production (DM: plan): packed products in bags, bulk ones in kg, for one shift on one day. Saved as a draft. */
const planNew: SheetKind = {
  title: "Plan production",
  sub: "Packed products in bags, bulk ones in kg. The maize and packaging it needs are worked out when it is submitted.",
  wide: true,
  cur: "US$",
  load: async () => {
    const lookups = await fetchJson<MillLookups>("/api/milling/lookups");
    const products: Slot[] = lookups.products
      .filter((product) => product.unit === "BAG" || product.category === "Bulk product")
      .slice(0, PRODUCT_SLOTS)
      .map((product) => ({ id: product.id, name: product.name, sub: product.unit === "BAG" ? "bags" : "kg" }));
    return { _products: products, day: today(), shift: "Day" };
  },
  sections: [
    {
      fields: [
        { id: "day", t: "date", l: "Day", half: true, earliest: "today" },
        { id: "shift", t: "seg", l: "Shift", half: true, o: ["Day", "Night"] },
      ],
    },
    {
      title: "What to make",
      fields: slotFields("products", PRODUCT_SLOTS, (index, item) => [
        {
          id: `amount${index}`,
          t: "text",
          l: "",
          lw: (values) => `${item(values)?.name ?? ""}, ${item(values)?.sub ?? ""}`,
          mono: true,
          right: true,
          inputMode: "numeric",
          opt: true,
          optQuiet: true,
          half: true,
          schema: whole,
        },
      ]),
    },
  ],
  note: "Saved as a draft. Submit it from the plan to work out the maize and packaging, then management approves it.",
  primary: "Save draft",
  primaryDisabled: (values) => !planLines(values).length,
  done: (result) => `${String((result as { code?: string } | null)?.code ?? "Plan")} saved`,
  next: (result) => {
    const id = (result as { id?: string } | null)?.id;
    return id ? `/milling/plan/${id}` : null;
  },
  submit: (values) => ({ method: "POST", url: "/api/milling/orders", body: { productionDate: values.day, shiftKind: values.shift === "Night" ? "NIGHT" : "DAY", lines: planLines(values) } }),
  invalidate: [["list"], ["milling"]],
  requires: [["ext:milling", "plan.edit"]],
};

function planLines(values: SheetValues) {
  return slotItems(values, "products").flatMap((product, index) => {
    const amount = numberOf(values[`amount${index}`]);
    if (!amount || amount <= 0) return [];
    return [product.sub === "bags" ? { productId: product.id, bags: amount } : { productId: product.id, kg: amount }];
  });
}

/** Send plans back (HM-A1, AP-A3): to the planner as drafts, with the reason. */
/** The ticked plans (a list's bulk), or the one plan its row menu opened on. */
const sendBackIds = (ctx: { id?: string | null; params: URLSearchParams }) => {
  const ids = (ctx.params.get("ids") ?? "").split(",").filter(Boolean);
  return ids.length ? ids : ctx.id ? [ctx.id] : [];
};

const planSendBack: SheetKind = {
  title: (ctx) => {
    const count = sendBackIds(ctx).length;
    return count === 1 ? "Send the plan back" : `Send ${count} plans back`;
  },
  sub: "They go back to the planner as drafts, with your reason.",
  cur: "US$",
  sections: [{ fields: [{ id: "reason", t: "area", l: "Why", rows: 3, needed: "Say why: the planner reads it.", schema: z.string().trim().min(3, "Say why: the planner reads it.").max(2000) }] }],
  note: "",
  primary: "Send back",
  done: (result) => decidedWords(result, "sent back"),
  doneWarn: (result) => someRefused(result),
  submit: (values, ctx) => ({
    method: "POST",
    url: "/api/milling/decide-many",
    body: { action: "send-back", reason: text(values.reason), items: sendBackIds(ctx).map((id) => ({ kind: "plan", id })) },
  }),
  invalidate: [["list"], ["milling"]],
  requires: [["ext:milling", "plan.approve"]],
};

type Results = { results?: Array<{ ok: boolean; message: string }> };
export function decidedWords(result: unknown, verb: string) {
  const rows = (result as Results | null)?.results ?? [];
  const done = rows.filter((row) => row.ok).length;
  const refused = rows.filter((row) => !row.ok).map((row) => row.message);
  return refused.length ? `${done} ${verb}. Not done: ${refused.join(" ")}` : `${done} ${verb}`;
}
export const someRefused = (result: unknown) => ((result as Results | null)?.results ?? []).some((row) => !row.ok);

/** Take an order: a customer, where it goes, when it is wanted, and the bags of each product. Saved as a draft. */
const orderNew: SheetKind = {
  title: "New order",
  sub: "Saved as a draft. Confirm it to reserve the bags, oldest first.",
  wide: true,
  cur: "US$",
  load: async () => {
    const lookups = await fetchJson<MillLookups>("/api/milling/lookups");
    const products = lookups.products.filter((product) => product.unit === "BAG").slice(0, PRODUCT_SLOTS);
    return {
      _customer: lookups.customers.map((row) => ({ id: row.id, label: row.name })),
      _destination: lookups.destinations.map((row) => ({ id: row.id, label: row.name })),
      _products: products.map((product) => ({ id: product.id, name: product.name })),
      ...Object.fromEntries(products.map((product, index) => [`price${index}`, product.standardPrice ? product.standardPrice.toFixed(2) : ""])),
      customer: "",
      destination: "Collected",
    };
  },
  sections: [
    {
      fields: [
        { id: "customer", t: "text", l: "Customer", o: (values) => labels(values, "customer"), needed: "Choose the customer." },
        { id: "destination", t: "text", l: "Deliver to", half: true, o: (values) => ["Collected", ...labels(values, "destination")] },
        { id: "wanted", t: "date", l: "Wanted by", half: true, opt: true, earliest: "today", clearable: true },
      ],
    },
    {
      title: "Bags",
      fields: slotFields("products", PRODUCT_SLOTS, (index, item) => [
        { id: `bags${index}`, t: "text", l: "", lw: (values) => item(values)?.name ?? "", mono: true, right: true, inputMode: "numeric", opt: true, optQuiet: true, half: true, p: "bags", schema: whole },
        { id: `price${index}`, t: "money", l: "Price a bag", mono: true, opt: true, optQuiet: true, half: true },
      ]),
    },
  ],
  note: "Prices are the list price; change one for this order only.",
  primary: "Save draft",
  primaryDisabled: (values) => !orderLines(values).length,
  done: (result) => `${String((result as { code?: string } | null)?.code ?? "Order")} saved`,
  submit: (values) => ({
    method: "POST",
    url: "/api/milling/customer-orders",
    body: { customerId: idOf(values, "customer"), destinationId: values.destination === "Collected" ? null : idOf(values, "destination"), requiredDate: values.wanted ?? null, lines: orderLines(values) },
  }),
  invalidate: [["list"], ["milling"]],
  requires: [["ext:milling", "order.manage"]],
};

function orderLines(values: SheetValues) {
  return slotItems(values, "products").flatMap((product, index) => {
    const bags = numberOf(values[`bags${index}`]);
    if (!bags || bags <= 0) return [];
    const price = numberOf(values[`price${index}`]);
    return [{ productId: product.id, bags, unitPrice: price && price > 0 ? price : null }];
  });
}

/** Plan a shift (DM: shift): its day, kind and start, the supervisor, and the crew with their duties. */
const shiftNew: SheetKind = {
  title: "Plan a shift",
  sub: "A night shift belongs to the day it starts.",
  wide: true,
  cur: "US$",
  load: async () => {
    const [people, duties] = await Promise.all([
      fetchJson<{ employees: Array<{ id: string; name: string; employeeId: string; jobTitle: string | null }>; users: Array<{ id: string; name: string }> }>("/api/milling/people"),
      fetchJson<{ rows: Array<{ id: string; name: string; isActive: boolean }> }>("/api/milling/settings/duties"),
    ]);
    return {
      _crew: people.employees.slice(0, CREW_SLOTS).map((employee) => ({ id: employee.id, name: employee.name, sub: employee.jobTitle ?? employee.employeeId })),
      _supervisor: people.users.map((user) => ({ id: user.id, label: user.name })),
      _duty: duties.rows.filter((duty) => duty.isActive).map((duty) => ({ id: duty.id, label: duty.name })),
      day: today(),
      kind: "Day",
      start: "06:00",
      supervisor: "None",
    };
  },
  sections: [
    {
      fields: [
        { id: "day", t: "date", l: "Day", half: true },
        { id: "kind", t: "seg", l: "Shift", half: true, o: ["Day", "Night"], follow: async (value) => ({ start: value === "Night" ? "22:00" : "06:00" }) },
        { id: "start", t: "text", l: "Starts", half: true, mono: true, p: "06:00", schema: z.string().regex(/^\d{2}:\d{2}$/, "As HH:MM.") },
        { id: "supervisor", t: "text", l: "Supervisor", half: true, o: (values) => labels(values, "supervisor", true) },
      ],
    },
    {
      title: "Crew",
      fields: slotFields("crew", CREW_SLOTS, (index, item) => [
        { id: `on${index}`, t: "toggle", l: "", lw: (values) => `${item(values)?.name ?? ""}${item(values)?.sub ? ` · ${item(values)?.sub}` : ""}`, half: true, opt: true, optQuiet: true },
        { id: `duty${index}`, t: "text", l: "Duty", half: true, opt: true, optQuiet: true, o: (values) => labels(values, "duty", true), disabled: (values) => values[`on${index}`] !== true },
      ]),
    },
  ],
  note: (values) => {
    const count = slotItems(values, "crew").filter((_, index) => values[`on${index}`] === true).length;
    return `${count} on the crew.`;
  },
  primary: "Plan shift",
  done: (result) => `${String((result as { code?: string } | null)?.code ?? "Shift")} planned`,
  next: (result) => {
    const id = (result as { id?: string } | null)?.id;
    return id ? `/milling/shifts/${id}` : null;
  },
  submit: (values) => ({
    method: "POST",
    url: "/api/milling/shifts",
    body: {
      date: values.day,
      kind: values.kind === "Night" ? "NIGHT" : "DAY",
      startTime: text(values.start),
      supervisorId: idOf(values, "supervisor"),
      crew: slotItems(values, "crew").flatMap((employee, index) => (values[`on${index}`] === true ? [{ employeeId: employee.id, dutyId: dutyId(values, index) }] : [])),
    },
  }),
  invalidate: [["list"], ["milling"]],
  requires: [["ext:milling", "shift.manage"]],
};

function dutyId(values: SheetValues, index: number) {
  const label = values[`duty${index}`];
  return ((values._duty as Choice[] | undefined) ?? []).find((duty) => duty.label === label)?.id ?? null;
}

/** Cancel orders: their reserved bags go back to stock; the reason is kept with each. */
const orderCancel: SheetKind = {
  title: (ctx) => {
    const count = (ctx.params.get("ids") ?? ctx.id ?? "").split(",").filter(Boolean).length;
    return count === 1 ? "Cancel the order" : `Cancel ${count} orders`;
  },
  sub: "Their reserved bags go back to stock.",
  cur: "US$",
  sections: [{ fields: [{ id: "reason", t: "area", l: "Why", rows: 3, needed: "Say why the order is cancelled.", schema: z.string().trim().min(3, "Say why the order is cancelled.").max(2000) }] }],
  note: "",
  primary: "Cancel orders",
  primaryTone: "danger",
  secondary: "Keep them",
  done: (result) => decidedWords(result, "cancelled"),
  doneWarn: (result) => someRefused(result),
  submit: (values, ctx) => ({ method: "POST", url: "/api/milling/customer-orders/cancel-many", body: { ids: (ctx.params.get("ids") ?? ctx.id ?? "").split(",").filter(Boolean), reason: text(values.reason) } }),
  invalidate: [["list"], ["milling"]],
  requires: [["ext:milling", "order.manage"]],
};

type PlanDetail = { order: { id: string; code: string; status: string }; needs: { maizeKg: number; maizeAvailableKg: number; packaging: Array<{ name: string; needed: number; available: number }>; short: string[] } };
const kgText = (value: number) => `${value.toLocaleString("en-GB", { maximumFractionDigits: 0 })} kg`;

/** Approve a plan (PR, AP-A1): its maize and packaging are reserved, oldest lots first. Short of either, it needs a reason. */
const planApprove: SheetKind = {
  title: (_ctx, values) => `Approve ${String(values._code ?? "the plan")}`,
  sub: (_ctx, values) => ((values._short as string[] | undefined) ?? []).length ? `Short of ${((values._short as string[]) ?? []).join("; ")}. It can be approved anyway, with a reason.` : "Its maize and packaging are reserved, oldest lots first.",
  cur: "US$",
  load: async (ctx) => {
    const plan = await fetchJson<PlanDetail>(`/api/milling/orders/${ctx.id}`);
    return { _code: plan.order.code, _short: plan.needs.short, _needs: plan.needs };
  },
  sections: [
    {
      fields: [
        {
          id: "_needsTable",
          t: "read",
          l: "What it needs",
          v: null,
          table: (values) => {
            const needs = values._needs as PlanDetail["needs"] | undefined;
            if (!needs) return null;
            return { head: ["", "Needed", "Free now"], rows: [["Maize", kgText(needs.maizeKg), kgText(needs.maizeAvailableKg)], ...needs.packaging.map((row) => [row.name, String(row.needed), String(row.available)])], end: [1, 2] };
          },
        },
        { id: "reason", t: "area", l: "Why approve it although short", rows: 2, show: (values) => ((values._short as string[] | undefined) ?? []).length > 0, needed: "Say why it is approved although short." },
      ],
    },
  ],
  note: "",
  primary: (values) => (((values._short as string[] | undefined) ?? []).length ? "Approve although short" : "Approve"),
  done: (_result, values) => `${String(values._code ?? "Plan")} approved`,
  submit: (values, ctx) => ({ method: "POST", url: `/api/milling/orders/${ctx.id}/approve`, body: { approveShort: ((values._short as string[] | undefined) ?? []).length > 0, reason: text(values.reason) || null } }),
  invalidate: [["list"], ["reports"], ["milling"], ["milling-plan"]],
  requires: [["ext:milling", "plan.approve"]],
};

/** Cancel a plan: its reservations are released. The reason is kept with it. */
const planCancel: SheetKind = {
  title: "Cancel the plan",
  sub: "Its maize and packaging reservations are released.",
  cur: "US$",
  sections: [{ fields: [{ id: "reason", t: "area", l: "Why", rows: 3, needed: "Say why the plan is cancelled.", schema: z.string().trim().min(3, "Say why the plan is cancelled.").max(2000) }] }],
  note: "",
  primary: "Cancel the plan",
  primaryTone: "danger",
  secondary: "Keep it",
  done: "Plan cancelled",
  submit: (values, ctx) => ({ method: "POST", url: `/api/milling/orders/${ctx.id}/cancel`, body: { reason: text(values.reason) } }),
  invalidate: [["list"], ["reports"], ["milling"], ["milling-plan"]],
  requires: [["ext:milling", "plan.edit"]],
};

type ShiftDetail = { shift: { id: string; code: string; materialInProcessKg: number | null; handoverNotes: string | null; assignments: Array<{ id: string; employeeId: string; name: string; dutyId: string | null; attendance: string; clockIn: string | null; clockOut: string | null; breakMinutes: number; absenceReason: string | null }> }; duties: Array<{ id: string; name: string }> };

/** Close a shift: what is left in the machines and bins, and the handover to the next one. */
const shiftClose: SheetKind = {
  title: (_ctx, values) => `Close ${String(values._code ?? "the shift")}`,
  sub: "What is left in the line closes each run's balance. The handover is read by the next shift.",
  cur: "US$",
  load: async (ctx) => {
    const detail = await fetchJson<ShiftDetail>(`/api/milling/shifts/${ctx.id}`);
    return { _code: detail.shift.code, material: detail.shift.materialInProcessKg === null ? "" : String(detail.shift.materialInProcessKg), how: "Estimated", handover: detail.shift.handoverNotes ?? "" };
  },
  sections: [
    {
      fields: [
        { id: "material", t: "text", l: "Left in machines and bins, kg", half: true, mono: true, right: true, inputMode: "decimal", opt: true },
        { id: "how", t: "seg", l: "The figure is", half: true, o: ["Measured", "Estimated"] },
        { id: "handover", t: "area", l: "Handover", rows: 4, opt: true, p: "What the next shift needs to know" },
      ],
    },
  ],
  note: "Management approves it next; approval sends attendance and overtime to People.",
  primary: "Close the shift",
  done: (_result, values) => `${String(values._code ?? "Shift")} closed`,
  submit: (values, ctx) => ({ method: "POST", url: `/api/milling/shifts/${ctx.id}/close`, body: { materialInProcessKg: text(values.material), materialEstimated: values.how !== "Measured", handoverNotes: text(values.handover) || null } }),
  invalidate: [["list"], ["reports"], ["milling"], ["milling-shift"]],
  requires: [["ext:milling", "shift.manage"]],
};

const ATTEND: Record<string, string> = { Present: "PRESENT", Late: "LATE", Absent: "ABSENT", "On leave": "ON_LEAVE" };
const hhmm = (value: string | null) => (value ? new Date(value).toLocaleTimeString("en-GB", { timeZone: "Africa/Harare", hour: "2-digit", minute: "2-digit" }) : "");
const atTime = (base: string | null, time: string) => {
  if (!time) return null;
  const day = base ? new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(base)) : new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(`${day}T${time}:00+02:00`).toISOString();
};

/** One person on a shift: their duty, attendance and time. Absence or leave needs its reason, for payroll. */
const shiftPerson: SheetKind = {
  title: (_ctx, values) => String(values._name ?? "Attendance and time"),
  sub: (_ctx, values) => `On ${String(values._code ?? "the shift")}. Overtime is worked out from the time against the shift's hours.`,
  cur: "US$",
  load: async (ctx) => {
    const detail = await fetchJson<ShiftDetail>(`/api/milling/shifts/${ctx.params.get("shift")}`);
    const row = detail.shift.assignments.find((entry) => entry.id === ctx.id);
    const _duty: Choice[] = detail.duties.map((duty) => ({ id: duty.id, label: duty.name }));
    const word = Object.entries(ATTEND).find(([, key]) => key === row?.attendance)?.[0] ?? "Present";
    return {
      _name: row?.name ?? "",
      _code: detail.shift.code,
      _employeeId: row?.employeeId ?? "",
      _clockBase: row?.clockIn ?? null,
      _duty,
      duty: _duty.find((option) => option.id === row?.dutyId)?.label ?? "None",
      attendance: word,
      reason: row?.absenceReason ?? "",
      clockIn: hhmm(row?.clockIn ?? null),
      clockOut: hhmm(row?.clockOut ?? null),
      breakMinutes: String(row?.breakMinutes ?? 0),
    };
  },
  sections: [
    {
      fields: [
        { id: "duty", t: "text", l: "Duty", o: (values) => labels(values, "duty", true) },
        { id: "attendance", t: "seg", l: "Attendance", o: Object.keys(ATTEND) },
        { id: "reason", t: "text", l: "Why", show: (values) => values.attendance === "Absent" || values.attendance === "On leave", needed: "Say why: it goes to their attendance for payroll." },
        { id: "clockIn", t: "text", l: "In", half: true, mono: true, p: "06:00", opt: true, show: (values) => values.attendance === "Present" || values.attendance === "Late", schema: z.string().regex(/^\d{2}:\d{2}$/, "As HH:MM.") },
        { id: "clockOut", t: "text", l: "Out", half: true, mono: true, p: "14:30", opt: true, show: (values) => values.attendance === "Present" || values.attendance === "Late", schema: z.string().regex(/^\d{2}:\d{2}$/, "As HH:MM.") },
        { id: "breakMinutes", t: "text", l: "Break, minutes", half: true, mono: true, right: true, inputMode: "numeric", opt: true, show: (values) => values.attendance === "Present" || values.attendance === "Late", schema: z.string().regex(/^\d+$/, "Whole minutes.") },
      ],
    },
  ],
  note: "",
  primary: "Save",
  done: (_result, values) => `${String(values._name ?? "Crew")} saved`,
  submit: (values, ctx) => {
    const present = values.attendance === "Present" || values.attendance === "Late";
    const base = (values._clockBase as string | null) ?? null;
    return {
      method: "POST",
      url: `/api/milling/shifts/${ctx.params.get("shift")}/crew`,
      body: {
        employeeId: values._employeeId,
        dutyId: idOf(values, "duty"),
        attendance: ATTEND[String(values.attendance)] ?? "PRESENT",
        absenceReason: present ? null : text(values.reason),
        ...(present ? { clockIn: atTime(base, text(values.clockIn)), clockOut: atTime(base, text(values.clockOut)), breakMinutes: numberOf(values.breakMinutes) ?? 0 } : {}),
      },
    };
  },
  invalidate: [["list"], ["reports"], ["milling"], ["milling-shift"]],
  requires: [["ext:milling", "shift.manage"]],
};

export const PLAN_SHEETS: Record<string, SheetKind> = {
  "mill-plan-new": planNew,
  "mill-plan-send-back": planSendBack,
  "mill-order-new": orderNew,
  "mill-order-cancel": orderCancel,
  "mill-shift-new": shiftNew,
  "mill-plan-approve": planApprove,
  "mill-plan-cancel": planCancel,
  "mill-shift-close": shiftClose,
  "mill-shift-person": shiftPerson,
};
