import { Prisma, type PrismaClient } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";
import { daysPastDue } from "@/lib/ageing";

import { millRefusal } from "../errors";
import { millDay } from "../sellers/trips";

/**
 * The mill's side of Customers (canvas CU-A1, CU-A2, HM-C1, HM-D1, NV04 R9).
 *
 * The customer record is core's; the mill keeps what it needs about a
 * customer beside it: what they may owe and their terms, a rep's visits to
 * their shop with the market survey taken there, and promises to pay. What a
 * customer owes is read from Books: their issued invoices, less what was paid,
 * credited or written off.
 */

type Db = PrismaClient;
const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

/** Each customer's open balance and how much of it is past due, from Books' issued invoices. */
export async function balancesOf(db: Db, companyId: string, customerIds?: string[], asOf: Date = new Date()) {
  const invoices = await db.salesInvoice.findMany({
    where: { companyId, status: "ISSUED", ...(customerIds ? { customerId: { in: customerIds } } : {}) },
    select: { id: true, invoiceNumber: true, customerId: true, dueDate: true, total: true, amountPaid: true, creditTotal: true, writeOffTotal: true },
  });
  const byCustomer = new Map<string, { owes: number; overdue: number; invoices: Array<{ id: string; number: string | null; due: Date | null; open: number; daysLate: number }> }>();
  for (const invoice of invoices) {
    const open = Math.round((invoice.total - invoice.amountPaid - invoice.creditTotal - invoice.writeOffTotal) * 100) / 100;
    if (open <= 0.005) continue;
    const late = daysPastDue(invoice.dueDate, asOf);
    const entry = byCustomer.get(invoice.customerId) ?? { owes: 0, overdue: 0, invoices: [] };
    entry.owes += open;
    if (late > 0) entry.overdue += open;
    entry.invoices.push({ id: invoice.id, number: invoice.invoiceNumber, due: invoice.dueDate, open, daysLate: late });
    byCustomer.set(invoice.customerId, entry);
  }
  for (const entry of byCustomer.values()) {
    entry.owes = Math.round(entry.owes * 100) / 100;
    entry.overdue = Math.round(entry.overdue * 100) / 100;
    entry.invoices.sort((a, b) => (a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0));
  }
  return byCustomer;
}

/** A customer's state as the canvas names it: over their limit, overdue, or current. */
export function customerState(balance: { owes: number; overdue: number } | undefined, creditLimit: number | null): "OVER_LIMIT" | "OVERDUE" | "CURRENT" {
  if (balance && creditLimit !== null && balance.owes > creditLimit) return "OVER_LIMIT";
  if (balance && balance.overdue > 0) return "OVERDUE";
  return "CURRENT";
}

/** Collections (CU-A1): every customer who owes, with route, limit, overdue, state and their latest promise. */
export async function collections(db: Db, companyId: string, asOf: Date = new Date()) {
  const balances = await balancesOf(db, companyId, undefined, asOf);
  const ids = [...balances.keys()];
  const [customers, terms, promises, routes] = await Promise.all([
    db.customer.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, name: true, routeId: true } }),
    db.millingCustomerTerms.findMany({ where: { companyId, customerId: { in: ids } } }),
    db.millingPaymentPromise.findMany({ where: { companyId, customerId: { in: ids } }, orderBy: { createdAt: "desc" } }),
    db.customerRoute.findMany({ where: { companyId }, select: { id: true, code: true } }),
  ]);
  const today = millDay(asOf);
  const rows = customers.map((customer) => {
    const balance = balances.get(customer.id)!;
    const term = terms.find((row) => row.customerId === customer.id);
    const creditLimit = term?.creditLimit === null || term?.creditLimit === undefined ? null : Number(term.creditLimit);
    const promise = promises.find((row) => row.customerId === customer.id);
    return {
      id: customer.id,
      name: customer.name,
      route: routes.find((route) => route.id === customer.routeId)?.code ?? null,
      creditLimit,
      termsDays: term?.termsDays ?? 14,
      owes: balance.owes,
      overdue: balance.overdue,
      state: customerState(balance, creditLimit),
      promise: promise ? { amount: Number(promise.amount), promisedFor: promise.promisedFor, passed: promise.promisedFor < today } : null,
    };
  });
  rows.sort((a, b) => b.overdue - a.overdue || b.owes - a.owes);
  const sum = (pick: (row: (typeof rows)[number]) => number | null) => Math.round(rows.reduce((total, row) => total + (pick(row) ?? 0), 0) * 100) / 100;
  return {
    rows,
    counts: { ALL: rows.length, OVERDUE: rows.filter((row) => row.overdue > 0).length, OVER_LIMIT: rows.filter((row) => row.state === "OVER_LIMIT").length },
    totals: { creditLimit: sum((row) => row.creditLimit), owes: sum((row) => row.owes), overdue: sum((row) => row.overdue) },
  };
}

/** One customer (CU-A2): what they owe, invoice by invoice, their limit and terms, and their promises. */
export async function customerAccount(db: Db, companyId: string, customerId: string, asOf: Date = new Date()) {
  const customer = await db.customer.findFirst({ where: { id: customerId, companyId }, select: { id: true, name: true, routeId: true, phone: true } });
  if (!customer) return null;
  const [balances, term, promises, route, visits] = await Promise.all([
    balancesOf(db, companyId, [customer.id], asOf),
    db.millingCustomerTerms.findUnique({ where: { companyId_customerId: { companyId, customerId } } }),
    db.millingPaymentPromise.findMany({ where: { companyId, customerId }, orderBy: { createdAt: "desc" }, take: 10 }),
    customer.routeId ? db.customerRoute.findFirst({ where: { id: customer.routeId }, select: { id: true, code: true } }) : null,
    db.millingVisit.findMany({ where: { companyId, customerId }, orderBy: { visitedAt: "desc" }, take: 5 }),
  ]);
  const balance = balances.get(customer.id) ?? { owes: 0, overdue: 0, invoices: [] };
  const creditLimit = term?.creditLimit === null || term?.creditLimit === undefined ? null : Number(term.creditLimit);
  return {
    ...customer,
    route,
    creditLimit,
    termsDays: term?.termsDays ?? 14,
    owes: balance.owes,
    overdue: balance.overdue,
    state: customerState(balance, creditLimit),
    invoices: balance.invoices,
    promises: promises.map((row) => ({ id: row.id, amount: Number(row.amount), promisedFor: row.promisedFor, note: row.note, createdAt: row.createdAt })),
    visits: visits.map((row) => ({ id: row.id, visitedAt: row.visitedAt, competitorPrice: row.competitorPrice === null ? null : Number(row.competitorPrice), shelfSharePct: row.shelfSharePct === null ? null : Number(row.shelfSharePct) })),
  };
}

export async function setCustomerTerms(db: Db, args: { companyId: string; userId: string; customerId: string; creditLimit: number | null; termsDays: number }) {
  const customer = await db.customer.findFirst({ where: { id: args.customerId, companyId: args.companyId }, select: { id: true } });
  if (!customer) throw millRefusal("That customer is not in this workspace.");
  if (args.creditLimit !== null && (!Number.isFinite(args.creditLimit) || args.creditLimit < 0)) throw millRefusal("A credit limit is nothing or more.");
  if (!Number.isInteger(args.termsDays) || args.termsDays < 0 || args.termsDays > 365) throw millRefusal("Terms are a whole number of days, up to a year.");
  const terms = await db.millingCustomerTerms.upsert({
    where: { companyId_customerId: { companyId: args.companyId, customerId: customer.id } },
    update: { creditLimit: args.creditLimit, termsDays: args.termsDays, updatedById: args.userId },
    create: { companyId: args.companyId, customerId: customer.id, creditLimit: args.creditLimit, termsDays: args.termsDays, updatedById: args.userId },
  });
  await writePlatformAuditEvent({ companyId: args.companyId, actorId: args.userId, eventType: "milling.customer.terms-changed", entityType: "Customer", entityId: customer.id, payload: { creditLimit: args.creditLimit, termsDays: args.termsDays } });
  return terms;
}

/** A promise to pay, recorded when chasing a customer. Only for what they owe, on a day not past. */
export async function recordPromise(db: Db, args: { companyId: string; userId: string; customerId: string; amount: number; promisedFor: string; note?: string | null; at?: Date }) {
  const amount = D(args.amount);
  if (amount.lte(0) || !amount.equals(amount.toDecimalPlaces(2))) throw millRefusal("Enter the amount promised, in dollars and cents.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.promisedFor)) throw millRefusal("Choose the day they promised to pay.");
  const day = new Date(`${args.promisedFor}T00:00:00.000Z`);
  if (day < millDay(args.at)) throw millRefusal("A promise is for today or later.");
  const balance = (await balancesOf(db, args.companyId, [args.customerId], args.at)).get(args.customerId);
  if (!balance) throw millRefusal("This customer owes nothing.");
  if (amount.gt(balance.owes)) throw millRefusal(`They owe $${balance.owes.toFixed(2)}; a promise cannot be for more.`);
  const promise = await db.millingPaymentPromise.create({
    data: { companyId: args.companyId, customerId: args.customerId, amount, promisedFor: day, note: args.note?.trim() || null, createdById: args.userId },
  });
  await writePlatformAuditEvent({ companyId: args.companyId, actorId: args.userId, eventType: "milling.customer.promise", entityType: "Customer", entityId: args.customerId, payload: { amount: amount.toFixed(2), promisedFor: args.promisedFor } });
  return promise;
}

export interface VisitInput {
  customerId: string;
  routeId?: string | null;
  competitorPrice?: number | null;
  ourBagsOnShelf?: number | null;
  shelfSharePct?: number | null;
  photoUrl?: string | null;
  note?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/** A shop visit (HM-D1): the competitor's price, our bags on the shelf and our share of it. Nothing is required but the shop. */
export async function recordVisit(db: Db, args: { companyId: string; userId: string; at?: Date } & VisitInput) {
  const customer = await db.customer.findFirst({ where: { id: args.customerId, companyId: args.companyId }, select: { id: true, routeId: true } });
  if (!customer) throw millRefusal("That shop is not one of the mill's customers.");
  if (args.competitorPrice != null && (!Number.isFinite(args.competitorPrice) || args.competitorPrice < 0)) throw millRefusal("A price is nothing or more.");
  if (args.ourBagsOnShelf != null && (!Number.isInteger(args.ourBagsOnShelf) || args.ourBagsOnShelf < 0)) throw millRefusal("Bags on the shelf are a whole number.");
  if (args.shelfSharePct != null && (!Number.isFinite(args.shelfSharePct) || args.shelfSharePct < 0 || args.shelfSharePct > 100)) throw millRefusal("Shelf share runs from 0 to 100%.");
  if ((args.latitude == null) !== (args.longitude == null)) throw millRefusal("A location needs both latitude and longitude.");
  const routeId = args.routeId ?? customer.routeId ?? null;
  if (routeId && !(await db.customerRoute.findFirst({ where: { id: routeId, companyId: args.companyId }, select: { id: true } }))) throw millRefusal("That route is not the mill's.");
  return db.millingVisit.create({
    data: {
      companyId: args.companyId,
      customerId: customer.id,
      routeId,
      repUserId: args.userId,
      visitedAt: args.at ?? new Date(),
      competitorPrice: args.competitorPrice ?? null,
      ourBagsOnShelf: args.ourBagsOnShelf ?? null,
      shelfSharePct: args.shelfSharePct ?? null,
      photoUrl: args.photoUrl?.trim() || null,
      note: args.note?.trim() || null,
      latitude: args.latitude ?? null,
      longitude: args.longitude ?? null,
    },
  });
}

/** Visits, newest first, with the shop, route and rep named. */
export async function listVisits(db: Db, companyId: string, args: { from?: Date; to?: Date; routeId?: string | null; repUserId?: string | null; take?: number } = {}) {
  const rows = await db.millingVisit.findMany({
    where: {
      companyId,
      ...(args.from || args.to ? { visitedAt: { ...(args.from ? { gte: args.from } : {}), ...(args.to ? { lt: args.to } : {}) } } : {}),
      ...(args.routeId ? { routeId: args.routeId } : {}),
      ...(args.repUserId ? { repUserId: args.repUserId } : {}),
    },
    orderBy: { visitedAt: "desc" },
    take: args.take ?? 200,
  });
  const [customers, routes, reps] = await Promise.all([
    db.customer.findMany({ where: { id: { in: rows.map((row) => row.customerId) } }, select: { id: true, name: true } }),
    db.customerRoute.findMany({ where: { companyId }, select: { id: true, code: true } }),
    db.user.findMany({ where: { companyId, id: { in: rows.map((row) => row.repUserId) } }, select: { id: true, name: true } }),
  ]);
  return rows.map((row) => ({
    id: row.id,
    visitedAt: row.visitedAt,
    customerId: row.customerId,
    customer: customers.find((entry) => entry.id === row.customerId)?.name ?? "",
    route: routes.find((entry) => entry.id === row.routeId)?.code ?? null,
    rep: reps.find((entry) => entry.id === row.repUserId)?.name ?? null,
    competitorPrice: row.competitorPrice === null ? null : Number(row.competitorPrice),
    ourBagsOnShelf: row.ourBagsOnShelf,
    shelfSharePct: row.shelfSharePct === null ? null : Number(row.shelfSharePct),
    photoUrl: row.photoUrl,
    note: row.note,
  }));
}

/** The market survey by route (R9): visits, shops seen, the average competitor price and our average shelf share. */
export async function surveyByRoute(db: Db, companyId: string, args: { from: Date; to: Date }) {
  const visits = await db.millingVisit.findMany({ where: { companyId, visitedAt: { gte: args.from, lt: args.to } } });
  const routes = await db.customerRoute.findMany({ where: { companyId }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
  const groups = new Map<string, typeof visits>();
  for (const visit of visits) {
    const key = visit.routeId ?? "";
    groups.set(key, [...(groups.get(key) ?? []), visit]);
  }
  const mean = (values: number[]) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : null);
  return [...groups.entries()]
    .map(([routeId, rows]) => {
      const route = routes.find((entry) => entry.id === routeId);
      return {
        routeId: routeId || null,
        route: route ? `${route.code}, ${route.name}` : "Not on a route",
        visits: rows.length,
        shops: new Set(rows.map((row) => row.customerId)).size,
        competitorPrice: mean(rows.flatMap((row) => (row.competitorPrice === null ? [] : [Number(row.competitorPrice)]))),
        shelfSharePct: mean(rows.flatMap((row) => (row.shelfSharePct === null ? [] : [Number(row.shelfSharePct)]))),
        ourBagsOnShelf: rows.reduce((sum, row) => sum + (row.ourBagsOnShelf ?? 0), 0),
      };
    })
    .sort((a, b) => a.route.localeCompare(b.route));
}
