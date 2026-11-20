import type { PrismaClient } from "@prisma/client";

import { millDay } from "../sellers/trips";
import { balancesOf, customerState } from "./customers";

/**
 * A sales rep's day (HM-C1): the route they work today, its shops in order,
 * what each owes, and which they have visited; the next one to visit.
 *
 * Today's route is the rep's route whose visit days include today; failing
 * that, the one chosen; failing that, their first. A rep with no route sees
 * none and is told so.
 */
export async function repDay(db: PrismaClient, args: { companyId: string; userId: string; routeId?: string | null; at?: Date }) {
  const day = millDay(args.at);
  const weekday = ((day.getUTCDay() + 6) % 7) + 1; // ISO: Monday 1 .. Sunday 7
  const routes = await db.customerRoute.findMany({
    where: { companyId: args.companyId, isActive: true, ...(args.routeId ? { id: args.routeId } : { repUserId: args.userId }) },
    orderBy: { code: "asc" },
  });
  const route = routes.find((row) => row.id === args.routeId) ?? routes.find((row) => row.visitDays.includes(weekday)) ?? routes[0] ?? null;
  if (!route) return { day, route: null, routes: [], stops: [], next: null };

  const customers = await db.customer.findMany({
    where: { companyId: args.companyId, routeId: route.id, archivedAt: null },
    orderBy: [{ routeStop: "asc" }, { name: "asc" }],
    select: { id: true, name: true, area: true, routeStop: true },
  });
  const tomorrow = new Date(day.getTime() + 86_400_000);
  // The mill's day starts at midnight in Harare (UTC+2).
  const from = new Date(day.getTime() - 2 * 3_600_000);
  const to = new Date(tomorrow.getTime() - 2 * 3_600_000);
  const [balances, terms, visits] = await Promise.all([
    balancesOf(db, args.companyId, customers.map((row) => row.id), args.at),
    db.millingCustomerTerms.findMany({ where: { companyId: args.companyId, customerId: { in: customers.map((row) => row.id) } } }),
    db.millingVisit.findMany({ where: { companyId: args.companyId, customerId: { in: customers.map((row) => row.id) }, visitedAt: { gte: from, lt: to } }, select: { customerId: true } }),
  ]);
  const visited = new Set(visits.map((row) => row.customerId));
  const stops = customers.map((customer, index) => {
    const balance = balances.get(customer.id);
    const term = terms.find((row) => row.customerId === customer.id);
    const limit = term?.creditLimit === null || term?.creditLimit === undefined ? null : Number(term.creditLimit);
    return {
      id: customer.id,
      name: customer.name,
      area: customer.area,
      stop: customer.routeStop ?? index + 1,
      owes: balance?.owes ?? 0,
      overdue: balance?.overdue ?? 0,
      state: customerState(balance, limit),
      visited: visited.has(customer.id),
    };
  });
  return {
    day,
    route: { id: route.id, code: route.code, name: route.name },
    routes: routes.map((row) => ({ id: row.id, code: row.code, name: row.name })),
    stops,
    next: stops.find((stop) => !stop.visited) ?? null,
  };
}
