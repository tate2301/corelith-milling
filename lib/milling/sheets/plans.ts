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
const planSendBack: SheetKind = {
  title: (ctx) => {
    const count = (ctx.params.get("ids") ?? "").split(",").filter(Boolean).length;
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
    body: { action: "send-back", reason: text(values.reason), items: (ctx.params.get("ids") ?? "").split(",").filter(Boolean).map((id) => ({ kind: "plan", id })) },
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

export const PLAN_SHEETS: Record<string, SheetKind> = {
  "mill-plan-new": planNew,
  "mill-plan-send-back": planSendBack,
  "mill-order-new": orderNew,
  "mill-order-cancel": orderCancel,
  "mill-shift-new": shiftNew,
};
