import { z } from "zod";

import { fetchJson } from "@/lib/api-client";
import type { SheetKind } from "@/lib/workspace/sheet-kind";

import { numberOf, text } from "./choices";

type Account = { name: string; owes: number; overdue: number; creditLimit: number | null; termsDays: number };
const money = (value: number) => "$" + value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** Record a promise to pay (CU-A1): how much and by when. A promise that passes unpaid shows on the customer. */
const promise: SheetKind = {
  title: (_ctx, values) => `Promise from ${String(values._name ?? "the customer")}`,
  sub: (_ctx, values) => (values._owes ? `Owes ${money(Number(values._owes))}${Number(values._overdue) ? `, ${money(Number(values._overdue))} overdue` : ""}.` : ""),
  cur: "US$",
  load: async (ctx) => {
    const account = await fetchJson<Account>(`/api/milling/customers/${ctx.id}`);
    return { _name: account.name, _owes: account.owes, _overdue: account.overdue, amount: account.overdue ? account.overdue.toFixed(2) : "", promisedFor: today() };
  },
  sections: [
    {
      fields: [
        { id: "amount", t: "money", l: "Amount", half: true, needed: "Enter the amount promised." },
        { id: "promisedFor", t: "date", l: "Pays by", half: true, earliest: "today" },
        { id: "note", t: "area", l: "Note", rows: 2, opt: true, p: "Who promised, and how they will pay" },
      ],
    },
  ],
  note: "",
  primary: "Record promise",
  done: (_result, values) => `Promise from ${String(values._name ?? "the customer")} recorded`,
  submit: (values, ctx) => ({
    method: "POST",
    url: `/api/milling/customers/${ctx.id}/promise`,
    body: { amount: numberOf(values.amount), promisedFor: values.promisedFor, note: text(values.note) || null },
  }),
  invalidate: [["list"], ["milling"]],
  requires: [["ext:milling", "collection.record"]],
};

/** Limit and terms (CU-A2): what the customer may owe, and the days they have to pay. Management sets them. */
const terms: SheetKind = {
  title: (_ctx, values) => `Limit and terms: ${String(values._name ?? "")}`,
  sub: "A despatch to a customer over their limit waits for management.",
  cur: "US$",
  load: async (ctx) => {
    const account = await fetchJson<Account>(`/api/milling/customers/${ctx.id}`);
    return { _name: account.name, creditLimit: account.creditLimit === null ? "" : account.creditLimit.toFixed(2), termsDays: String(account.termsDays) };
  },
  sections: [
    {
      fields: [
        { id: "creditLimit", t: "money", l: "Credit limit", half: true, opt: true, h: "Empty: no limit." },
        { id: "termsDays", t: "text", l: "Days to pay", half: true, mono: true, right: true, inputMode: "numeric", schema: z.string().regex(/^\d{1,3}$/, "Days, 0 to 365.") },
      ],
    },
  ],
  note: "",
  primary: "Save",
  done: "Limit and terms saved",
  submit: (values, ctx) => ({
    method: "POST",
    url: `/api/milling/customers/${ctx.id}/terms`,
    body: { creditLimit: text(values.creditLimit) ? numberOf(values.creditLimit) : null, termsDays: numberOf(values.termsDays) ?? 14 },
  }),
  invalidate: [["list"], ["milling"]],
  requires: [["ext:milling", "exception.decide"]],
};

export const CUSTOMER_SHEETS: Record<string, SheetKind> = {
  "mill-promise": promise,
  "mill-terms": terms,
};
