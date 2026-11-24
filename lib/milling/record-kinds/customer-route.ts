import { fetchJson } from "@/lib/api-client";
import type { HistoryEntry } from "@/lib/milling/records/history";
import type { Grant, RecordKind } from "@/lib/retail/record-kinds/types";

import { historyRail } from "./shared";

const usd = (value: number) => "$" + value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (value: string) => new Date(value).toLocaleDateString("en-GB", { timeZone: "Africa/Harare", weekday: "short", day: "numeric", month: "short" });

export type CustomerView = {
  id: string;
  name: string;
  phone: string | null;
  route: { id: string; code: string } | null;
  creditLimit: number | null;
  termsDays: number;
  owes: number;
  overdue: number;
  state: "OVER_LIMIT" | "OVERDUE" | "CURRENT";
  invoices: Array<{ id: string }>;
  promises: Array<{ id: string; amount: number; promisedFor: string; note: string | null; createdAt: string }>;
  visits: Array<{ id: string; visitedAt: string; competitorPrice: number | null; shelfSharePct: number | null }>;
  history: HistoryEntry[];
};

const COLLECT: Grant = ["ext:milling", "collection.record"];
const DECIDE: Grant = ["ext:milling", "exception.decide"];

/**
 * A customer's account (canvas CU-A2) on core's RecordFrame: what they owe
 * against their limit, their unpaid invoices and despatches, promises and
 * history. Record a promise is the primary; limit and terms are management's.
 */
export const customerKind: RecordKind<CustomerView> = {
  type: "Customer",
  back: { label: "Collections", href: "/milling/collections" },
  queryKey: (id) => ["milling-customer", id],
  load: async (id) => {
    const [account, history] = await Promise.all([
      fetchJson<Omit<CustomerView, "history">>(`/api/milling/customers/${id}`),
      fetchJson<HistoryEntry[]>(`/api/milling/history?entityType=Customer&entityId=${id}`).catch(() => []),
    ]);
    return { ...account, history };
  },
  title: (customer) => customer.name,
  reference: (customer) => customer.route?.code ?? null,
  primary: (customer) => ({ key: "promise", label: "Record a promise", requires: [COLLECT], do: { sheet: "mill-promise", id: customer.id } }),
  actions: (customer) => [{ key: "terms", label: "Limit and terms", requires: [DECIDE], do: { sheet: "mill-terms", id: customer.id } }],
  banner: (customer) =>
    customer.state === "OVER_LIMIT" && customer.creditLimit !== null
      ? { lead: `${customer.name} is over their limit.`, text: `They owe ${usd(customer.owes)} against ${usd(customer.creditLimit)}. A despatch to them waits for management.`, tone: "bad" }
      : customer.state === "OVERDUE"
        ? { lead: `${usd(customer.overdue)} is overdue.`, text: `Their terms are ${customer.termsDays} days.` }
        : null,
  chips: (customer) => [
    customer.state === "OVER_LIMIT" ? { label: "Over limit", tone: "bad" } : customer.state === "OVERDUE" ? { label: "Overdue", tone: "warn" } : { label: "Current", tone: "ok" },
    { label: `${customer.termsDays} days`, tone: "plain" },
  ],
  figure: (customer) => ({ label: `owed, ${customer.invoices.length} ${customer.invoices.length === 1 ? "invoice" : "invoices"}`, value: usd(customer.owes) }),
  kpis: (customer) => {
    const promise = customer.promises[0];
    return [
      { label: "Credit limit", value: customer.creditLimit === null ? "No limit" : usd(customer.creditLimit), note: customer.creditLimit === null ? "Set under Limit and terms" : `${usd(Math.max(0, customer.creditLimit - customer.owes))} left` },
      { label: "Overdue", value: usd(customer.overdue), note: customer.overdue > 0 ? "past their terms" : "Nothing overdue", ...(customer.overdue > 0 ? { lead: "Late", leadTone: "warn" as const } : {}) },
      { label: "Terms", value: `${customer.termsDays} days`, note: "from the invoice date" },
      { label: "Promised", value: promise ? usd(promise.amount) : "—", note: promise ? `by ${day(promise.promisedFor)}` : "No promise yet" },
    ];
  },
  tabs: [
    { key: "invoices", label: "Unpaid invoices", source: "milling-customer-invoices", parent: "customer" },
    { key: "despatches", label: "Despatches", source: "milling-customer-despatches", parent: "customer" },
    { key: "visits", label: "Visits", source: "milling-visit-list", parent: "shop", filters: () => ({ date: "any" }), columns: ["visited", "rep", "competitorPrice", "ourBags", "share", "note"] },
  ],
  rail: (customer) => [
    {
      title: "Account",
      rows: [
        { key: "route", label: "Route", value: customer.route?.code ?? "None", mono: Boolean(customer.route), muted: !customer.route, ...(customer.route ? { links: [{ label: customer.route.code, href: `/milling/routes/${customer.route.id}` }] } : {}) },
        { key: "phone", label: "Phone", value: customer.phone ?? "None", mono: Boolean(customer.phone), muted: !customer.phone },
        { key: "books", label: "In Books", value: "Their invoices and payments", links: [{ label: "Open in Books", href: `/books/customers/${customer.id}` }] },
      ],
    },
    {
      title: "Promises",
      rows: customer.promises.length
        ? customer.promises.slice(0, 4).map((row) => ({ key: row.id, label: day(row.promisedFor), value: `${usd(row.amount)}${row.note ? `, ${row.note}` : ""}` }))
        : [{ key: "none", label: "None yet", value: "", muted: true }],
    },
    historyRail(customer.history),
  ],
  invalidates: [["list"], ["reports"], ["milling"]],
};

export type RouteView = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  visitDays: number[];
  visitDaysLabel: string;
  vehicleId: string | null;
  vehicle: string | null;
  rep: { id: string; name: string } | null;
  stops: Array<{ id: string; name: string; area: string | null; stop: number }>;
  trips: Array<{ km: number | null; litres: number | null; kmPerLitre: number | null; date: string }>;
  history: HistoryEntry[];
};

const DESPATCH: Grant = ["ext:milling", "delivery.manage"];

/** A route and its stops (canvas DS-B3) on core's RecordFrame: the shops in order, its last trips, and Plan a trip. */
export const routeKind: RecordKind<RouteView> = {
  type: "CustomerRoute",
  back: { label: "Routes", href: "/milling/routes" },
  queryKey: (id) => ["milling-route", id],
  load: async (id) => {
    const [route, history] = await Promise.all([
      fetchJson<Omit<RouteView, "history">>(`/api/milling/routes/${id}`),
      fetchJson<HistoryEntry[]>(`/api/milling/history?entityType=CustomerRoute&entityId=${id}`).catch(() => []),
    ]);
    return { ...route, history };
  },
  title: (route) => route.name,
  reference: (route) => route.code,
  primary: (route) => ({
    key: "trip",
    label: "Plan a trip",
    requires: [DESPATCH],
    disabled: !route.vehicleId ? "Give the route its usual truck first." : !route.stops.length ? "Add its stops first." : undefined,
    do: { post: { url: `/api/milling/routes/${route.id}/trip`, done: "Trip planned. Load its stops' orders on the despatch note.", ask: { title: `Plan a trip on ${route.code}?`, body: `A despatch note for ${route.vehicle ?? "its truck"}, ready to load the stops' confirmed orders.`, keep: "Not now", go: "Plan the trip", fill: "action" } } },
  }),
  actions: (route) => [
    { key: "edit", label: "Edit route", requires: [DESPATCH], do: { sheet: "mill-route-edit", id: route.id } },
    { key: "stops", label: "Stops", requires: [DESPATCH], do: { sheet: "mill-route-stops", id: route.id } },
  ],
  banner: (route) => (route.isActive ? null : { lead: "This route is stopped.", text: "It plans no trips and the rep's day leaves it out." }),
  chips: (route) => [{ label: route.isActive ? "Running" : "Stopped", tone: route.isActive ? "ok" : "plain" }, { label: route.visitDaysLabel || "No days set", tone: "plain" }],
  figure: (route) => (route.trips[0]?.km ? { label: `last trip${route.trips[0].kmPerLitre ? `, ${route.trips[0].kmPerLitre} km a litre` : ""}`, value: `${route.trips[0].km} km` } : null),
  kpis: (route) => [
    { label: "Stops", value: String(route.stops.length), note: "in visiting order" },
    { label: "Visit days", value: route.visitDaysLabel || "—", note: "the rep's day follows them" },
    { label: "Usual vehicle", value: route.vehicle ?? "None", note: route.vehicle ? "planned onto each trip" : "Set under Edit route" },
    { label: "Rep", value: route.rep?.name ?? "None", note: "visits the stops" },
  ],
  tabs: [
    { key: "stops", label: "Stops in order", source: "milling-route-stops", parent: "route" },
    { key: "trips", label: "Last trips", source: "milling-trip-list", parent: "onRoute", filters: () => ({ date: "any", tab: "all" }), columns: ["code", "date", "vehicle", "driver", "state", "km", "litres", "kmPerLitre"] },
  ],
  rail: (route) => [historyRail(route.history)],
  invalidates: [["list"], ["reports"], ["milling"]],
};
