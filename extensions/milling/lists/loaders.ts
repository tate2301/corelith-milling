import { prisma } from "@/lib/prisma";
import { result } from "@/lib/reports/loaders/shared";
import type { ReportLoader, ReportRow } from "@/lib/reports/types";

import { targetHref } from "@/components/milling/targets";
import { listRoutes, listTrips, vehicleLabels } from "@/lib/milling/distribution/trips";
import { followWorkshop } from "@/lib/milling/maintenance/equipment";
import { checkWeightSummary } from "@/lib/milling/production/packing";
import { SETTINGS_RESOURCES } from "@/lib/milling/settings/fields";
import { passingRule } from "@/lib/milling/settings/form";
import { listSettings } from "@/lib/milling/settings/server";
import { millSite, stockOnHand } from "@/lib/milling/stock/views";
import { commissionStatement } from "@/lib/milling/books/commission-statement";
import { balancesOf, collections, listVisits } from "@/lib/milling/customers/customers";
import { routeDetail } from "@/lib/milling/distribution/trips";
import { sellersBoard } from "@/lib/milling/sellers/views";
import { EXCEPTION_TYPES } from "@/lib/milling/exceptions/exceptions";
import { DECISION_LABEL } from "@/lib/milling/exceptions/words";
import { loadMillAccess } from "@/lib/milling/access/server";
import { waitingFor } from "@/lib/milling/reports/home";
import { MILL_GROUPS } from "@/lib/milling/access/groups";
import { listMillMembers } from "@/lib/milling/access/membership";
import { currentOpening, goLiveSteps, openingView } from "@/lib/milling/setup/go-live";

/** The mill's clock: Zimbabwe has one zone. */
const ZONE = "Africa/Harare";
/** A calendar day in the mill's zone, as list periods read it: `YYYY-MM-DD`. */
const isoDay = (value: Date | string) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const dayText = (value: Date | string) => new Date(value).toLocaleDateString("en-GB", { timeZone: ZONE, weekday: "short", day: "numeric", month: "short" });
const clock = (value: Date | string) => new Date(value).toLocaleTimeString("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit" });
const distinct = (values: Array<string | null | undefined>) => [...new Set(values.filter((value): value is string => Boolean(value)))].sort().map((value) => ({ value, label: value }));

async function userNames(companyId: string, ids: Array<string | null | undefined>) {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!wanted.length) return new Map<string, string>();
  const users = await prisma.user.findMany({ where: { companyId, id: { in: wanted } }, select: { id: true, name: true } });
  return new Map(users.map((user) => [user.id, user.name ?? ""]));
}

/** Despatch › Trips: every trip that has left, through the same reader as the trips API. */
const trips: ReportLoader = {
  load: async (ctx, params) => {
    const { trips: rows } = await listTrips(prisma, ctx.companyId, { take: 2000, routeId: params.onRoute ?? null });
    return result(
      rows.map(
        (trip): ReportRow => ({
          id: trip.id,
          code: trip.code,
          routeId: trip.route?.id ?? null,
          route: trip.route?.code ?? null,
          vehicle: trip.vehicle,
          driver: trip.driver,
          stateKey: trip.status === "CLOSED" ? "CLOSED" : "OUT",
          state: trip.status === "CLOSED" ? "Closed" : "Out",
          date: isoDay(trip.date),
          dateText: dayText(trip.date),
          delivered: `${trip.delivered} of ${trip.stops}`,
          km: trip.km,
          litres: trip.litres,
          kmPerLitre: trip.kmPerLitre,
        }),
      ),
    );
  },
  options: async (ctx) => {
    const { trips: rows } = await listTrips(prisma, ctx.companyId, { take: 2000 });
    const routes = await prisma.customerRoute.findMany({ where: { companyId: ctx.companyId }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
    return {
      route: routes.map((route) => ({ value: route.id, label: `${route.code} ${route.name}` })),
      vehicle: distinct(rows.map((row) => row.vehicle)),
      driver: distinct(rows.map((row) => row.driver)),
    };
  },
};

const INTAKE_STATE: Record<string, string> = { AWAITING_QC: "Awaiting QC", HELD: "Held", ACCEPTED: "Accepted", REJECTED: "Rejected", CANCELLED: "Cancelled" };
const WEIGHED_BY: Record<string, string> = { BAG_COUNT: "Bag count", EXTERNAL_TICKET: "Weighbridge ticket", SUPPLIER_DECLARED: "Supplier's weight" };

/** Intake: every weighbridge ticket, newest first. */
const intake: ReportLoader = {
  load: async (ctx) => {
    const rows = await prisma.millingIntake.findMany({ where: { companyId: ctx.companyId }, orderBy: { receivedAt: "desc" }, take: 5000 });
    const names = await userNames(ctx.companyId, rows.map((row) => row.receivedById));
    return result(
      rows.map((row): ReportRow => {
        const netKg = Number(row.netKg);
        return {
          id: row.id,
          code: row.code,
          truck: row.vehicleReg,
          supplier: row.supplierName,
          deliveryRef: row.deliveryRef,
          stateKey: row.status,
          state: INTAKE_STATE[row.status] ?? row.status,
          weightKey: row.weightStatus,
          weight: row.weightStatus === "VERIFIED" ? "Verified" : "Provisional",
          method: WEIGHED_BY[row.weighMethod] ?? row.weighMethod,
          netKg,
          value: row.pricePerTonne === null ? null : Math.round((netKg / 1000) * Number(row.pricePerTonne) * 100) / 100,
          typedBy: names.get(row.receivedById) ?? null,
          receivedAt: row.receivedAt.toISOString(),
          date: isoDay(row.receivedAt),
          time: clock(row.receivedAt),
        };
      }),
    );
  },
  options: async (ctx) => {
    const rows = await prisma.millingIntake.findMany({ where: { companyId: ctx.companyId }, select: { supplierName: true }, distinct: ["supplierName"] });
    return { supplier: distinct(rows.map((row) => row.supplierName)), method: Object.values(WEIGHED_BY).map((value) => ({ value, label: value })) };
  },
};

const SEVERITY: Record<string, string> = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" };
const typeLabel = (type: string) => EXCEPTION_TYPES[type as keyof typeof EXCEPTION_TYPES] ?? type;

/** Exceptions: every one raised, open and decided. */
const exceptions: ReportLoader = {
  load: async (ctx) => {
    const rows = await prisma.millingException.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: "desc" }, take: 5000 });
    const names = await userNames(ctx.companyId, rows.flatMap((row) => [row.raisedById, row.decidedById]));
    return result(
      rows.map(
        (row): ReportRow => ({
          id: row.id,
          code: row.code,
          title: row.title,
          type: typeLabel(row.type),
          severity: SEVERITY[row.severity] ?? row.severity,
          stateKey: row.status,
          state: row.status === "OPEN" ? "Open" : "Decided",
          decision: row.decision ? `${DECISION_LABEL[row.decision] ?? row.decision}${row.decidedById ? `, ${names.get(row.decidedById) ?? ""}` : ""}` : null,
          decide: row.status === "OPEN" ? "Decide" : null,
          raisedBy: row.raisedById ? (names.get(row.raisedById) ?? null) : "The mill",
          raisedAt: row.createdAt.toISOString(),
          raised: isoDay(row.createdAt),
          raisedTime: clock(row.createdAt),
          raisedText: `${dayText(row.createdAt)} ${clock(row.createdAt)}`,
          date: isoDay(row.createdAt),
          targetHref: targetHref(row.targetType, row.targetId),
        }),
      ),
    );
  },
  options: async () => ({ type: Object.values(EXCEPTION_TYPES).map((value) => ({ value: String(value), label: String(value) })) }),
};

const RUN_STATE: Record<string, string> = { OPEN: "Started", IN_PROGRESS: "Running", AWAITING_DECISION: "On hold", COMPLETED: "Completed" };
const dayAndTime = (value: Date) => `${new Date(value).toLocaleDateString("en-GB", { timeZone: ZONE, weekday: "short" })} ${clock(value)}`;

/** Production › Runs: every batch, newest first, with its shift, plan and output. */
const runs: ReportLoader = {
  load: async (ctx) => {
    const rows = await prisma.millingBatch.findMany({ where: { companyId: ctx.companyId }, orderBy: { startedAt: "desc" }, take: 5000, include: { outputs: { select: { quantityKg: true } } } });
    const [shifts, plans, names] = await Promise.all([
      prisma.millingShift.findMany({ where: { companyId: ctx.companyId, id: { in: rows.map((row) => row.shiftId).filter((id): id is string => Boolean(id)) } }, select: { id: true, kind: true } }),
      prisma.millingProductionOrder.findMany({ where: { companyId: ctx.companyId, id: { in: rows.map((row) => row.orderId).filter((id): id is string => Boolean(id)) } }, select: { id: true, code: true } }),
      userNames(ctx.companyId, rows.map((row) => row.createdById)),
    ]);
    return result(
      rows.map((row): ReportRow => {
        const maizeKg = Number(row.maizeIssuedKg);
        const outputKg = row.outputKg === null ? row.outputs.reduce((sum, output) => sum + Number(output.quantityKg), 0) : Number(row.outputKg);
        const kind = shifts.find((shift) => shift.id === row.shiftId)?.kind;
        return {
          id: row.id,
          code: row.code,
          planId: row.orderId,
          shiftId: row.shiftId,
          shift: kind === "NIGHT" ? "Night" : kind === "DAY" ? "Day" : null,
          plan: plans.find((plan) => plan.id === row.orderId)?.code ?? null,
          stateKey: row.status,
          state: RUN_STATE[row.status] ?? row.status,
          maizeKg,
          outputKg,
          extraction: maizeKg > 0 && outputKg > 0 ? Math.round((outputKg / maizeKg) * 1000) / 10 : null,
          startedBy: names.get(row.createdById) ?? null,
          startedAt: row.startedAt.toISOString(),
          started: dayAndTime(row.startedAt),
          date: isoDay(row.startedAt),
        };
      }),
    );
  },
};

/** Production › Packing: every packing run, newest first. */
const packing: ReportLoader = {
  load: async (ctx) => {
    const rows = await prisma.millingPackRun.findMany({ where: { companyId: ctx.companyId }, orderBy: { packedAt: "desc" }, take: 5000 });
    const recipes = await prisma.millingPackRecipe.findMany({ where: { companyId: ctx.companyId } });
    const [products, lots, names] = await Promise.all([
      prisma.product.findMany({ where: { companyId: ctx.companyId, id: { in: recipes.map((recipe) => recipe.packedProductId) } }, select: { id: true, name: true } }),
      prisma.millingLot.findMany({ where: { companyId: ctx.companyId, id: { in: rows.map((row) => row.bulkLotId) } }, select: { id: true, code: true } }),
      userNames(ctx.companyId, rows.map((row) => row.packedById)),
    ]);
    return result(
      rows.map((row): ReportRow => {
        const recipe = recipes.find((entry) => entry.id === row.recipeId);
        const checks = checkWeightSummary(row.checkWeights.map(Number), Number(recipe?.kgPerBag ?? 0));
        return {
          id: row.id,
          code: row.code,
          product: products.find((product) => product.id === recipe?.packedProductId)?.name ?? null,
          bulkLot: lots.find((lot) => lot.id === row.bulkLotId)?.code ?? null,
          bags: row.bagsPacked,
          damaged: row.damagedBags,
          bulkKg: Number(row.bulkUsedKg),
          varianceKg: Number(row.varianceKg),
          checks: !checks ? "Not taken" : checks.under > 0 ? "Light" : "In range",
          checksTone: !checks ? "hollow" : checks.under > 0 ? "warn" : "ok",
          packedBy: names.get(row.packedById) ?? null,
          packedAt: row.packedAt.toISOString(),
          packed: dayAndTime(row.packedAt),
          date: isoDay(row.packedAt),
        };
      }),
    );
  },
  options: async (ctx) => {
    const recipes = await prisma.millingPackRecipe.findMany({ where: { companyId: ctx.companyId }, select: { packedProductId: true } });
    const products = await prisma.product.findMany({ where: { companyId: ctx.companyId, id: { in: recipes.map((recipe) => recipe.packedProductId) } }, select: { name: true } });
    return { product: distinct(products.map((product) => product.name)) };
  },
};

const LOT_STATE: Record<string, string> = { HOLD: "On hold", AVAILABLE: "Released", RELEASED: "Released", REJECTED: "Rejected", CONSUMED: "Used" };
const ORIGIN: Record<string, string> = { BATCH: "Run", INTAKE: "Intake", RETURN: "Return" };

/** Quality › Tests: lots that pass through QC, with their latest test and anything they wait on. */
const tests: ReportLoader = {
  load: async (ctx) => {
    const lots = await prisma.millingLot.findMany({ where: { companyId: ctx.companyId, originType: { in: ["BATCH", "RETURN", "INTAKE"] } }, orderBy: { producedAt: "desc" }, include: { balances: true }, take: 5000 });
    const ids = lots.map((lot) => lot.id);
    const [products, inspections, open] = await Promise.all([
      prisma.product.findMany({ where: { companyId: ctx.companyId, id: { in: lots.map((lot) => lot.productId) } }, select: { id: true, name: true } }),
      prisma.millingQcInspection.findMany({ where: { companyId: ctx.companyId, targetType: "MillingLot", targetId: { in: ids } }, orderBy: { inspectedAt: "desc" } }),
      prisma.millingException.findMany({ where: { companyId: ctx.companyId, targetType: "MillingLot", targetId: { in: ids }, status: "OPEN" }, select: { targetId: true, code: true } }),
    ]);
    return result(
      lots.map((lot): ReportRow => {
        const last = inspections.find((inspection) => inspection.targetId === lot.id);
        const lastTest = !last ? "Not tested" : last.outcome === "PASS" ? "Passed" : last.outcome === "FAIL" ? "Failed" : "Incomplete";
        return {
          id: lot.id,
          code: lot.code,
          product: products.find((product) => product.id === lot.productId)?.name ?? null,
          origin: ORIGIN[lot.originType] ?? lot.originType,
          quantity: lot.balances.reduce((sum, row) => sum + Number(row.quantity), 0),
          lastTest,
          lastTestTone: lastTest === "Passed" ? "ok" : lastTest === "Failed" ? "bad" : lastTest === "Incomplete" ? "warn" : "hollow",
          stateKey: lot.status,
          state: LOT_STATE[lot.status] ?? lot.status,
          waiting: open.filter((row) => row.targetId === lot.id).map((row) => row.code).join(", ") || null,
          producedAt: lot.producedAt.toISOString(),
          made: dayAndTime(lot.producedAt),
          date: isoDay(lot.producedAt),
        };
      }),
    );
  },
};

const DELIVERY_STATE: Record<string, string> = { PLANNED: "Planned", LOADING: "Loading", DISPATCHED: "Out", DELIVERED: "Delivered", CLOSED: "Closed", CANCELLED: "Cancelled" };

/** Despatch › Despatches: every despatch note, its customers and its load. */
const despatches: ReportLoader = {
  load: async (ctx) => {
    const rows = await prisma.millingDelivery.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: "desc" }, take: 5000, include: { lines: { select: { bags: true, orderId: true, productId: true } } } });
    const orderIds = [...new Set(rows.flatMap((row) => row.lines.map((line) => line.orderId)))];
    const [orders, vehicles, products, destinations] = await Promise.all([
      prisma.millingCustomerOrder.findMany({ where: { companyId: ctx.companyId, id: { in: orderIds } }, select: { id: true, customerId: true } }),
      vehicleLabels(prisma, ctx.companyId, [...new Set(rows.map((row) => row.vehicleId))]),
      prisma.product.findMany({ where: { companyId: ctx.companyId, id: { in: rows.flatMap((row) => row.lines.map((line) => line.productId)) } }, select: { id: true, netWeightKg: true } }),
      prisma.millingDestination.findMany({ where: { companyId: ctx.companyId }, select: { id: true, name: true } }),
    ]);
    const customers = await prisma.customer.findMany({ where: { companyId: ctx.companyId, id: { in: orders.map((order) => order.customerId) } }, select: { id: true, name: true } });
    const customerOf = (orderId: string) => customers.find((customer) => customer.id === orders.find((order) => order.id === orderId)?.customerId)?.name ?? null;
    return result(
      rows.map((row): ReportRow => {
        const names = [...new Set(row.lines.map((line) => customerOf(line.orderId)).filter((name): name is string => Boolean(name)))];
        const kg = row.lines.reduce((sum, line) => sum + line.bags * Number(products.find((product) => product.id === line.productId)?.netWeightKg ?? 0), 0);
        return {
          id: row.id,
          code: row.code,
          customers: names.join(", ") || null,
          firstCustomer: names[0] ?? null,
          stateKey: row.status,
          state: DELIVERY_STATE[row.status] ?? row.status,
          vehicle: vehicles(row.vehicleId),
          destination: destinations.find((entry) => entry.id === row.destinationId)?.name ?? null,
          bags: row.lines.reduce((sum, line) => sum + line.bags, 0),
          tonnes: Math.round((kg / 1000) * 10) / 10,
          createdAt: row.createdAt.toISOString(),
          issued: dayAndTime(row.createdAt),
          date: isoDay(row.createdAt),
        };
      }),
    );
  },
  options: async (ctx) => {
    const customers = await prisma.customer.findMany({ where: { companyId: ctx.companyId, archivedAt: null }, select: { name: true }, orderBy: { name: "asc" }, take: 500 });
    const used = await prisma.millingDelivery.findMany({ where: { companyId: ctx.companyId }, select: { vehicleId: true }, distinct: ["vehicleId"] });
    const label = await vehicleLabels(prisma, ctx.companyId, used.map((row) => row.vehicleId));
    return { customer: distinct(customers.map((row) => row.name)), vehicle: distinct(used.map((row) => label(row.vehicleId))) };
  },
};

/** Despatch › Routes: the routes the trucks run. */
const routes: ReportLoader = {
  load: async (ctx) => {
    const rows = await listRoutes(prisma, ctx.companyId);
    return result(
      rows.map(
        (route): ReportRow => ({
          id: route.id,
          code: route.code,
          name: route.name,
          areas: route.areas,
          stops: route.stops,
          days: route.visitDaysLabel,
          vehicle: route.vehicle,
          km: route.km,
          stateKey: route.isActive ? "ACTIVE" : "STOPPED",
        }),
      ),
    );
  },
};

const ORDER_STATE: Record<string, string> = { DRAFT: "Draft", CONFIRMED: "Confirmed", IN_DELIVERY: "On a truck", DELIVERED: "Delivered", CLOSED: "Closed", CANCELLED: "Cancelled" };

/** Despatch › Orders: what customers ordered. */
const orders: ReportLoader = {
  load: async (ctx) => {
    const rows = await prisma.millingCustomerOrder.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: "desc" }, take: 5000, include: { lines: true } });
    const [customers, destinations, products] = await Promise.all([
      prisma.customer.findMany({ where: { companyId: ctx.companyId, id: { in: rows.map((row) => row.customerId) } }, select: { id: true, name: true } }),
      prisma.millingDestination.findMany({ where: { companyId: ctx.companyId }, select: { id: true, name: true } }),
      prisma.product.findMany({ where: { companyId: ctx.companyId, id: { in: rows.flatMap((row) => row.lines.map((line) => line.productId)) } }, select: { id: true, name: true, netWeightKg: true } }),
    ]);
    const product = (id: string) => products.find((entry) => entry.id === id);
    return result(
      rows.map(
        (row): ReportRow => ({
          id: row.id,
          code: row.code,
          customerId: row.customerId,
          customer: customers.find((customer) => customer.id === row.customerId)?.name ?? null,
          destination: destinations.find((entry) => entry.id === row.destinationId)?.name ?? "Collected",
          products: row.lines.map((line) => `${line.bags} × ${product(line.productId)?.name ?? ""}`).join(", "),
          stateKey: row.status,
          state: ORDER_STATE[row.status] ?? row.status,
          bags: row.lines.reduce((sum, line) => sum + line.bags, 0),
          kg: row.lines.reduce((sum, line) => sum + line.bags * Number(product(line.productId)?.netWeightKg ?? 0), 0),
          invoiced: row.invoiceId ? "Yes" : "No",
          needed: row.requiredDate ? isoDay(row.requiredDate) : null,
          createdAt: row.createdAt.toISOString(),
          date: row.requiredDate ? isoDay(row.requiredDate) : isoDay(row.createdAt),
        }),
      ),
    );
  },
  options: async (ctx) => {
    const rows = await prisma.millingCustomerOrder.findMany({ where: { companyId: ctx.companyId }, select: { customerId: true }, distinct: ["customerId"] });
    const customers = await prisma.customer.findMany({ where: { companyId: ctx.companyId, id: { in: rows.map((row) => row.customerId) } }, select: { name: true } });
    return { customer: distinct(customers.map((row) => row.name)) };
  },
};

const PLAN_STATE: Record<string, string> = { DRAFT: "Draft", SUBMITTED: "To approve", APPROVED: "Approved", IN_PROGRESS: "Running", COMPLETED: "Done", CLOSED: "Done", CANCELLED: "Cancelled" };

/** Production › Plan: every production plan, newest day first. */
const plans: ReportLoader = {
  load: async (ctx) => {
    const rows = await prisma.millingProductionOrder.findMany({ where: { companyId: ctx.companyId }, orderBy: [{ productionDate: "desc" }, { code: "desc" }], take: 5000, include: { lines: true } });
    const [products, names] = await Promise.all([
      prisma.product.findMany({ where: { companyId: ctx.companyId, id: { in: rows.flatMap((row) => row.lines.map((line) => line.productId)) } }, select: { id: true, name: true } }),
      userNames(ctx.companyId, rows.map((row) => row.supervisorId)),
    ]);
    const name = (id: string) => products.find((product) => product.id === id)?.name ?? "";
    return result(
      rows.map(
        (row): ReportRow => ({
          id: row.id,
          code: row.code,
          date: row.productionDate.toISOString().slice(0, 10),
          dateText: row.productionDate.toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }),
          shift: row.shiftKind === "NIGHT" ? "Night" : "Day",
          stateKey: row.status,
          state: PLAN_STATE[row.status] ?? row.status,
          products: row.lines.map((line) => (line.bags ? `${line.bags} × ${name(line.productId)}` : `${Number(line.kg).toLocaleString("en-GB")} kg ${name(line.productId)}`)).join(", "),
          maizeKg: Number(row.maizeNeededKg),
          short: row.approvedShort ? "Approved short" : null,
          supervisor: row.supervisorId ? (names.get(row.supervisorId) ?? null) : null,
        }),
      ),
    );
  },
};

const SHIFT_STATE: Record<string, string> = { PLANNED: "Planned", OPEN: "Open", CLOSED: "To approve", APPROVED: "Approved" };

/** Production › Shifts: every shift, newest first, with its crew. */
const shifts: ReportLoader = {
  load: async (ctx) => {
    const rows = await prisma.millingShift.findMany({ where: { companyId: ctx.companyId }, orderBy: { scheduledStart: "desc" }, take: 5000, include: { assignments: { select: { attendance: true } } } });
    const names = await userNames(ctx.companyId, rows.map((row) => row.supervisorId));
    return result(
      rows.map(
        (row): ReportRow => ({
          id: row.id,
          code: row.code,
          kind: row.kind === "NIGHT" ? "Night" : "Day",
          stateKey: row.status,
          state: SHIFT_STATE[row.status] ?? row.status,
          starts: dayAndTime(row.scheduledStart),
          startsAt: row.scheduledStart.toISOString(),
          date: isoDay(row.scheduledStart),
          supervisor: row.supervisorId ? (names.get(row.supervisorId) ?? null) : null,
          crew: row.assignments.length,
          present: row.assignments.filter((assignment) => ["PRESENT", "LATE"].includes(assignment.attendance)).length,
        }),
      ),
    );
  },
};

const CUSTOMER_STATE: Record<string, string> = { CURRENT: "Current", OVERDUE: "Overdue", OVER_LIMIT: "Over limit" };
const dollars = (value: number) => "$" + value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Customers › Collections: everyone Books says owes the mill. */
const customers: ReportLoader = {
  load: async (ctx) => {
    const { rows } = await collections(prisma, ctx.companyId);
    return result(
      rows.map(
        (row): ReportRow => ({
          id: row.id,
          name: row.name,
          route: row.route,
          terms: `${row.termsDays} days`,
          creditLimit: row.creditLimit,
          owes: row.owes,
          overdue: row.overdue,
          promise: row.promise ? `${dollars(row.promise.amount)} by ${dayText(row.promise.promisedFor)}` : null,
          promiseTone: row.promise?.passed ? "warn" : null,
          stateKey: row.state,
          state: CUSTOMER_STATE[row.state] ?? row.state,
        }),
      ),
    );
  },
  options: async (ctx) => {
    const routes = await prisma.customerRoute.findMany({ where: { companyId: ctx.companyId }, select: { code: true }, orderBy: { code: "asc" } });
    return { route: distinct(routes.map((route) => route.code)) };
  },
};

/** Customers › Visits: every shop visit, newest first. */
const visits: ReportLoader = {
  load: async (ctx, params) => {
    const all = await listVisits(prisma, ctx.companyId, { take: 5000 });
    const rows = params.shop ? all.filter((row) => row.customerId === params.shop) : all;
    return result(
      rows.map(
        (row): ReportRow => ({
          id: row.id,
          customerId: row.customerId,
          customer: row.customer,
          route: row.route,
          rep: row.rep,
          competitorPrice: row.competitorPrice,
          ourBags: row.ourBagsOnShelf,
          share: row.shelfSharePct,
          note: row.note,
          visitedAt: row.visitedAt.toISOString(),
          visited: dayAndTime(row.visitedAt),
          date: isoDay(row.visitedAt),
        }),
      ),
    );
  },
  options: async (ctx) => {
    const rows = await listVisits(prisma, ctx.companyId, { take: 5000 });
    return { route: distinct(rows.map((row) => row.route)), rep: distinct(rows.map((row) => row.rep)) };
  },
};

const STOP_KIND: Record<string, string> = { BREAKDOWN: "Breakdown", POWER: "Power", MATERIAL: "No maize", PLANNED: "Planned", OTHER: "Other" };

async function machineNames(companyId: string, ids: Array<string | null>) {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const rows = wanted.length ? await prisma.equipment.findMany({ where: { id: { in: wanted }, site: { companyId } }, select: { id: true, name: true } }) : [];
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** Production › Downtime: every stop, newest first; an open one runs to now. */
const downtime: ReportLoader = {
  load: async (ctx) => {
    const rows = await prisma.millingDowntime.findMany({ where: { companyId: ctx.companyId }, orderBy: { startedAt: "desc" }, take: 5000 });
    const [machines, runs] = await Promise.all([
      machineNames(ctx.companyId, rows.map((row) => row.equipmentId)),
      prisma.millingBatch.findMany({ where: { companyId: ctx.companyId, id: { in: rows.map((row) => row.batchId).filter((id): id is string => Boolean(id)) } }, select: { id: true, code: true } }),
    ]);
    const now = Date.now();
    return result(
      rows.map(
        (row): ReportRow => ({
          id: row.id,
          machine: row.equipmentId ? (machines.get(row.equipmentId) ?? null) : "Whole mill",
          cause: row.cause,
          category: STOP_KIND[row.category] ?? row.category,
          runId: row.batchId,
          run: runs.find((run) => run.id === row.batchId)?.code ?? null,
          stateKey: row.endedAt ? "CLOSED" : "OPEN",
          state: row.endedAt ? "Closed" : "Stopped",
          end: row.endedAt ? null : "End",
          from: dayAndTime(row.startedAt),
          to: row.endedAt ? dayAndTime(row.endedAt) : null,
          hours: Math.round((((row.endedAt?.getTime() ?? now) - row.startedAt.getTime()) / 3_600_000) * 10) / 10,
          startedAt: row.startedAt.toISOString(),
          date: isoDay(row.startedAt),
        }),
      ),
    );
  },
  options: async (ctx) => {
    const rows = await prisma.millingDowntime.findMany({ where: { companyId: ctx.companyId }, select: { equipmentId: true }, distinct: ["equipmentId"] });
    const machines = await machineNames(ctx.companyId, rows.map((row) => row.equipmentId));
    return { machine: distinct([...machines.values(), ...(rows.some((row) => !row.equipmentId) ? ["Whole mill"] : [])]) };
  },
};

/** Production › Generator log: every generator run, newest first. */
const generator: ReportLoader = {
  load: async (ctx) => {
    const rows = await prisma.millingGeneratorRun.findMany({ where: { companyId: ctx.companyId }, orderBy: { startedAt: "desc" }, take: 5000 });
    const machines = await machineNames(ctx.companyId, rows.map((row) => row.equipmentId));
    return result(
      rows.map((row): ReportRow => {
        const hours = Math.round(((row.endedAt.getTime() - row.startedAt.getTime()) / 3_600_000) * 10) / 10;
        const litres = Number(row.litres);
        return {
          id: row.id,
          generator: row.equipmentId ? (machines.get(row.equipmentId) ?? null) : "Generator",
          from: dayAndTime(row.startedAt),
          to: dayAndTime(row.endedAt),
          meterFrom: row.meterStart === null ? null : Number(row.meterStart),
          meterTo: row.meterEnd === null ? null : Number(row.meterEnd),
          hours,
          litres,
          perHour: hours > 0 ? Math.round((litres / hours) * 10) / 10 : null,
          reason: row.reason,
          startedAt: row.startedAt.toISOString(),
          date: isoDay(row.startedAt),
        };
      }),
    );
  },
  options: async (ctx) => {
    const rows = await prisma.millingGeneratorRun.findMany({ where: { companyId: ctx.companyId }, select: { equipmentId: true }, distinct: ["equipmentId"] });
    const machines = await machineNames(ctx.companyId, rows.map((row) => row.equipmentId));
    return { generator: distinct([...machines.values()]) };
  },
};

/** A trip's stops: its lines by order, with what each delivered and what it is worth. Without a trip, nothing. */
const stops: ReportLoader = {
  load: async (ctx, params) => {
    const deliveryId = params.delivery;
    if (!deliveryId) return result([]);
    const delivery = await prisma.millingDelivery.findFirst({ where: { id: deliveryId, companyId: ctx.companyId }, include: { lines: true } });
    if (!delivery) return result([]);
    const [orders, orderLines, products, lots] = await Promise.all([
      prisma.millingCustomerOrder.findMany({ where: { companyId: ctx.companyId, id: { in: delivery.lines.map((line) => line.orderId) } }, select: { id: true, code: true, customerId: true } }),
      prisma.millingCustomerOrderLine.findMany({ where: { id: { in: delivery.lines.map((line) => line.orderLineId) } }, select: { id: true, unitPrice: true } }),
      prisma.product.findMany({ where: { companyId: ctx.companyId, id: { in: delivery.lines.map((line) => line.productId) } }, select: { id: true, name: true } }),
      prisma.millingLot.findMany({ where: { companyId: ctx.companyId, id: { in: delivery.lines.map((line) => line.lotId) } }, select: { id: true, code: true } }),
    ]);
    const customers = await prisma.customer.findMany({ where: { companyId: ctx.companyId, id: { in: orders.map((order) => order.customerId) } }, select: { id: true, name: true } });
    const proven = ["DELIVERED", "CLOSED"].includes(delivery.status);
    return result(
      delivery.lines.map((line, index): ReportRow => {
        const order = orders.find((entry) => entry.id === line.orderId);
        const price = Number(orderLines.find((entry) => entry.id === line.orderLineId)?.unitPrice ?? 0);
        const delivered = line.deliveredBags;
        const state = !proven ? "Loaded" : !delivered ? "Not delivered" : line.shortBags || line.damagedBags || line.returnedBags ? "Short" : "Delivered";
        return {
          id: line.id,
          deliveryId: delivery.id,
          order: `${String(index + 1).padStart(2, "0")} ${order?.code ?? ""}`.trim(),
          customerId: order?.customerId ?? null,
          customer: customers.find((customer) => customer.id === order?.customerId)?.name ?? null,
          product: products.find((product) => product.id === line.productId)?.name ?? null,
          lot: lots.find((lot) => lot.id === line.lotId)?.code ?? null,
          state,
          bags: line.bags,
          delivered: proven ? delivered : null,
          short: proven ? line.shortBags || null : null,
          damaged: proven ? line.damagedBags || null : null,
          returned: proven ? line.returnedBags || null : null,
          value: price ? Math.round(price * (proven ? (delivered ?? 0) : line.bags) * 100) / 100 : null,
        };
      }),
    );
  },
};

const usd = (value: number) => "$" + value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Despatch › Sellers: every seller, where they are today, what they owe and the commission due. */
const sellers: ReportLoader = {
  load: async (ctx) => {
    const board = await sellersBoard(prisma, ctx.companyId);
    return result(
      board.sellers.map(
        (seller): ReportRow => ({
          id: seller.id,
          name: seller.name,
          number: seller.number,
          activeKey: seller.isActive ? "ACTIVE" : "STOPPED",
          todayKey: !seller.isActive ? "STOPPED" : seller.outOn ? "OUT" : "IN",
          today: !seller.isActive ? "Not selling" : seller.outOn ? "Out selling" : "In",
          trip: seller.outOn?.code ?? null,
          owed: seller.owed,
          owedPill: seller.owed > 0 ? "warn" : null,
          commissionDue: seller.commissionDue,
          commissionDueText: usd(seller.commissionDue),
        }),
      ),
    );
  },
};

const sellerNames = async (companyId: string, ids: string[]) => {
  const rows = await prisma.millingSeller.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, employeeId: true } });
  const employees = await prisma.employee.findMany({ where: { companyId, id: { in: rows.map((row) => row.employeeId) } }, select: { id: true, name: true } });
  return new Map(rows.map((row) => [row.id, employees.find((employee) => employee.id === row.employeeId)?.name ?? ""]));
};

/** Despatch › Seller trips: every trip, newest first; on a seller, only theirs. */
const sellerTrips: ReportLoader = {
  load: async (ctx, params) => {
    const trips = await prisma.millingSellerTrip.findMany({
      where: { companyId: ctx.companyId, ...(params.seller ? { sellerId: params.seller } : {}) },
      orderBy: { issuedAt: "desc" },
      take: 5000,
      include: { lines: { select: { bagsOut: true, bagsSold: true } } },
    });
    const [names, places] = await Promise.all([
      sellerNames(ctx.companyId, [...new Set(trips.map((trip) => trip.sellerId))]),
      prisma.stockLocation.findMany({ where: { id: { in: [...new Set(trips.map((trip) => trip.fromLocationId))] } }, select: { id: true, name: true } }),
    ]);
    return result(
      trips.map((trip): ReportRow => {
        const short = trip.shortage === null ? null : Number(trip.shortage);
        const settled = trip.status === "SETTLED";
        return {
          id: trip.id,
          code: trip.code,
          sellerId: trip.sellerId,
          seller: names.get(trip.sellerId) ?? null,
          from: places.find((place) => place.id === trip.fromLocationId)?.name ?? null,
          stateKey: trip.status,
          state: trip.status === "OUT" ? "Out" : trip.status === "CANCELLED" ? "Cancelled" : short ? "Short" : "Settled",
          bagsOut: trip.lines.reduce((sum, line) => sum + line.bagsOut, 0),
          sold: settled ? trip.lines.reduce((sum, line) => sum + (line.bagsSold ?? 0), 0) : null,
          due: trip.amountDue === null ? null : Number(trip.amountDue),
          cash: trip.cashReceived === null ? null : Number(trip.cashReceived),
          short: short || null,
          shortPill: short ? "warn" : null,
          postKey: settled && !trip.invoiceId ? "TO_POST" : settled ? "POSTED" : null,
          books: settled ? (trip.invoiceId ? "Posted" : "To post") : null,
          date: trip.tripDate.toISOString().slice(0, 10),
          issuedAt: trip.issuedAt.toISOString(),
        };
      }),
    );
  },
  options: async (ctx) => {
    const rows = await prisma.millingSeller.findMany({ where: { companyId: ctx.companyId }, select: { id: true } });
    const names = await sellerNames(ctx.companyId, rows.map((row) => row.id));
    return { who: distinct([...names.values()]) };
  },
};

/** A seller's commission, trip by trip, oldest commission paid first. */
const sellerCommission: ReportLoader = {
  load: async (ctx, params) => {
    if (!params.seller) return result([]);
    const statement = await commissionStatement(prisma, ctx.companyId, params.seller);
    return result(
      statement.trips.map(
        (trip): ReportRow => ({
          id: trip.id,
          sellerId: params.seller!,
          code: trip.code,
          date: new Date(trip.date).toISOString().slice(0, 10),
          workings: trip.products
            .map((line) => [line.perBag ? `${line.bags} × ${usd(line.perBag)}` : null, line.pct ? `${line.pct}% of ${usd(line.soldFor)}` : null].filter(Boolean).join(" + ") + ` (${line.product})`)
            .join("; "),
          earned: trip.earned,
          paid: trip.paid,
          due: trip.due,
          state: trip.due <= 0.005 ? "Paid" : trip.paid > 0 ? "Part paid" : "Due",
        }),
      ),
    );
  },
};

/** A seller's payments: money handed in, and commission paid to them. */
const sellerPayments: ReportLoader = {
  load: async (ctx, params) => {
    if (!params.seller) return result([]);
    const [money, statement] = await Promise.all([
      prisma.millingSellerPayment.findMany({ where: { companyId: ctx.companyId, sellerId: params.seller }, orderBy: { receivedAt: "desc" } }),
      commissionStatement(prisma, ctx.companyId, params.seller),
    ]);
    const trips = await prisma.millingSellerTrip.findMany({ where: { companyId: ctx.companyId, id: { in: money.map((row) => row.tripId).filter((id): id is string => Boolean(id)) } }, select: { id: true, code: true } });
    const rows: ReportRow[] = [
      ...money.map(
        (row): ReportRow => ({
          id: row.id,
          sellerId: params.seller!,
          at: row.receivedAt.toISOString().slice(0, 10),
          what: row.kind === "SETTLEMENT" ? "Settlement cash" : "Handed in",
          covers: row.kind === "SETTLEMENT" ? `Cash for ${trips.find((trip) => trip.id === row.tripId)?.code ?? "a trip"}` : "Against what they owe",
          reference: row.booksReference,
          postKey: row.kind === "REPAYMENT" && !row.postedAt ? "TO_POST" : null,
          amount: Number(row.amount),
        }),
      ),
      ...statement.payments.map(
        (row): ReportRow => ({
          id: row.id,
          sellerId: params.seller!,
          at: new Date(row.paidAt).toISOString().slice(0, 10),
          what: "Commission paid",
          covers: row.covers.map((cover) => `${cover.code} ${usd(cover.amount)}`).join(", ") || null,
          reference: row.billNumber,
          postKey: null,
          amount: row.amount,
        }),
      ),
    ];
    return result(rows);
  },
};

/** A customer's unpaid invoices, from Books. */
const customerInvoices: ReportLoader = {
  load: async (ctx, params) => {
    if (!params.customer) return result([]);
    const balances = await balancesOf(prisma, ctx.companyId, [params.customer]);
    const rows = balances.get(params.customer)?.invoices ?? [];
    return result(
      rows.map(
        (invoice): ReportRow => ({
          id: invoice.id,
          customerId: params.customer!,
          number: invoice.number,
          due: invoice.due ? isoDay(invoice.due) : null,
          dueText: invoice.due ? dayText(invoice.due) : "—",
          state: invoice.daysLate > 0 ? "Overdue" : "Current",
          late: invoice.daysLate > 0 ? invoice.daysLate : null,
          open: invoice.open,
        }),
      ),
    );
  },
};

/** A customer's despatches: their orders' lines on trips. */
const customerDespatches: ReportLoader = {
  load: async (ctx, params) => {
    if (!params.customer) return result([]);
    const orders = await prisma.millingCustomerOrder.findMany({ where: { companyId: ctx.companyId, customerId: params.customer }, select: { id: true, code: true } });
    const lines = await prisma.millingDeliveryLine.findMany({ where: { orderId: { in: orders.map((order) => order.id) } }, include: { delivery: true } });
    const byNote = new Map<string, { line: (typeof lines)[number]; bags: number; delivered: number; short: number }>();
    for (const line of lines) {
      const key = `${line.deliveryId}|${line.orderId}`;
      const entry = byNote.get(key) ?? { line, bags: 0, delivered: 0, short: 0 };
      entry.bags += line.bags;
      entry.delivered += line.deliveredBags ?? 0;
      entry.short += line.shortBags + line.damagedBags;
      byNote.set(key, entry);
    }
    return result(
      [...byNote.values()].map(({ line, bags, delivered, short }): ReportRow => {
        const status = line.delivery.status;
        const proven = ["DELIVERED", "CLOSED"].includes(status);
        return {
          id: `${line.deliveryId}-${line.orderId}`,
          customerId: params.customer!,
          deliveryId: line.deliveryId,
          code: line.delivery.code,
          order: orders.find((order) => order.id === line.orderId)?.code ?? null,
          date: isoDay(line.delivery.dispatchedAt ?? line.delivery.createdAt),
          state: proven ? (!delivered ? "Not delivered" : short ? "Short" : "Delivered") : (DELIVERY_STATE[status] ?? status),
          bags,
        };
      }),
    );
  },
};

/** A route's stops, in order, with what each owes. */
const routeStops: ReportLoader = {
  load: async (ctx, params) => {
    if (!params.route) return result([]);
    const route = await routeDetail(prisma, ctx.companyId, params.route);
    if (!route) return result([]);
    const balances = await balancesOf(prisma, ctx.companyId, route.stops.map((stop) => stop.id));
    return result(
      route.stops.map(
        (stop): ReportRow => ({ id: stop.id, routeId: route.id, stop: stop.stop, customer: stop.name, area: stop.area, owes: balances.get(stop.id)?.owes ?? 0 }),
      ),
    );
  },
};

const QC_METHOD: Record<string, string> = { VISUAL: "Visual", INSTRUMENT: "Instrument", EXTERNAL_LAB: "External lab", NOT_PERFORMED: "Not performed" };

/** A delivery's or a lot's test results, every test, newest first. */
const qcResults: ReportLoader = {
  load: async (ctx, params) => {
    const targetId = params.intake ?? params.lot;
    if (!targetId) return result([]);
    const inspections = await prisma.millingQcInspection.findMany({
      where: { companyId: ctx.companyId, targetType: params.intake ? "MillingIntake" : "MillingLot", targetId },
      orderBy: { inspectedAt: "desc" },
      include: { results: true },
    });
    const specs = await prisma.millingQcSpec.findMany({ where: { companyId: ctx.companyId, id: { in: inspections.flatMap((row) => row.results.map((r) => r.specId)) } }, select: { id: true, unit: true, minValue: true, maxValue: true } });
    return result(
      inspections.flatMap((inspection) =>
        inspection.results.map((row): ReportRow => {
          const spec = specs.find((entry) => entry.id === row.specId);
          const unit = spec?.unit ?? "";
          return {
            id: row.id,
            targetId,
            check: row.specName,
            method: QC_METHOD[row.method] ?? row.method,
            reading: row.value === null ? null : `${Number(row.value)}${unit}`,
            limit: spec?.maxValue !== null && spec?.maxValue !== undefined ? `${spec.minValue !== null ? `${Number(spec.minValue)}–` : "≤ "}${Number(spec.maxValue)}${unit}` : null,
            result: row.method === "NOT_PERFORMED" ? "Not performed" : row.passed === false ? "Failed" : "Passed",
            inspectedAt: isoDay(inspection.inspectedAt),
          };
        }),
      ),
    );
  },
};

async function runOf(companyId: string, runId: string | undefined) {
  if (!runId) return null;
  return prisma.millingBatch.findFirst({ where: { id: runId, companyId }, include: { sources: true, stages: { orderBy: { startedAt: "asc" } }, outputs: true } });
}
async function locationCodes(companyId: string) {
  const rows = await prisma.stockLocation.findMany({ where: { site: { companyId } }, select: { id: true, code: true } });
  return new Map(rows.map((row) => [row.id, row.code]));
}

/** A run's stage records, in the order they ran. */
const runStages: ReportLoader = {
  load: async (ctx, params) => {
    const run = await runOf(ctx.companyId, params.run);
    if (!run) return result([]);
    const [stages, names] = await Promise.all([
      prisma.millingProcessStage.findMany({ where: { companyId: ctx.companyId, id: { in: run.stages.map((row) => row.stageId) } }, select: { id: true, name: true } }),
      userNames(ctx.companyId, run.stages.map((row) => row.operatorId)),
    ]);
    return result(
      run.stages.map(
        (row): ReportRow => ({
          id: row.id,
          runId: run.id,
          stage: stages.find((stage) => stage.id === row.stageId)?.name ?? row.stageCode,
          ran: `${clock(row.startedAt)}${row.endedAt ? `–${clock(row.endedAt)}` : ", running"}`,
          inputKg: row.inputKg === null ? null : Number(row.inputKg),
          removedKg: row.removedKg === null ? null : Number(row.removedKg),
          how: row.inputKg === null && row.removedKg === null ? null : row.inputEstimated || row.removedEstimated ? "Estimated" : "Weighed",
          operator: names.get(row.operatorId) ?? null,
          flag: row.abnormal ? "Abnormal" : null,
          startedAt: row.startedAt.toISOString(),
        }),
      ),
    );
  },
};

/** The maize a run took in. */
const runMaize: ReportLoader = {
  load: async (ctx, params) => {
    const run = await runOf(ctx.companyId, params.run);
    if (!run) return result([]);
    const [lots, places] = await Promise.all([
      prisma.millingLot.findMany({ where: { id: { in: run.sources.map((row) => row.lotId) } }, select: { id: true, code: true } }),
      locationCodes(ctx.companyId),
    ]);
    return result(
      run.sources.map((row): ReportRow => ({ id: row.id, runId: run.id, lot: lots.find((lot) => lot.id === row.lotId)?.code ?? null, place: places.get(row.stockLocationId) ?? null, kg: Number(row.quantityKg) })),
    );
  },
};

/** What a run put out, and the share of its maize each is. */
const runOutputs: ReportLoader = {
  load: async (ctx, params) => {
    const run = await runOf(ctx.companyId, params.run);
    if (!run) return result([]);
    const [lots, products, places] = await Promise.all([
      prisma.millingLot.findMany({ where: { id: { in: run.outputs.map((row) => row.lotId) } }, select: { id: true, code: true, status: true } }),
      prisma.product.findMany({ where: { companyId: ctx.companyId, id: { in: run.outputs.map((row) => row.productId) } }, select: { id: true, name: true } }),
      locationCodes(ctx.companyId),
    ]);
    const maize = Number(run.maizeIssuedKg);
    return result(
      run.outputs.map((row): ReportRow => {
        const lot = lots.find((entry) => entry.id === row.lotId);
        const kgOut = Number(row.quantityKg);
        return {
          id: row.id,
          runId: run.id,
          product: products.find((product) => product.id === row.productId)?.name ?? null,
          lotId: row.lotId,
          lot: lot?.code ?? null,
          place: places.get(row.stockLocationId) ?? null,
          how: row.isEstimated ? "Estimated" : "Weighed",
          state: lot ? (LOT_STATE[lot.status] ?? lot.status) : null,
          kg: kgOut,
          share: maize > 0 ? Math.round((kgOut / maize) * 1000) / 10 : null,
        };
      }),
    );
  },
};

/** A plan's lines: what it is to make, in bags or kilograms. */
const planLines: ReportLoader = {
  load: async (ctx, params) => {
    if (!params.plan) return result([]);
    const plan = await prisma.millingProductionOrder.findFirst({ where: { id: params.plan, companyId: ctx.companyId }, include: { lines: true } });
    if (!plan) return result([]);
    const products = await prisma.product.findMany({ where: { companyId: ctx.companyId, id: { in: plan.lines.map((line) => line.productId) } }, select: { id: true, name: true } });
    return result(
      plan.lines.map((line): ReportRow => ({ id: line.id, planId: plan.id, product: products.find((product) => product.id === line.productId)?.name ?? null, bags: line.bags, kg: Number(line.kg) })),
    );
  },
};

const ATTENDANCE_WORD: Record<string, string> = { PRESENT: "Present", LATE: "Late", ABSENT: "Absent", ON_LEAVE: "On leave" };

/** A shift's crew: each person's duty, attendance, time and overtime. */
const shiftCrew: ReportLoader = {
  load: async (ctx, params) => {
    if (!params.shift) return result([]);
    const shift = await prisma.millingShift.findFirst({ where: { id: params.shift, companyId: ctx.companyId }, include: { assignments: true } });
    if (!shift) return result([]);
    const [employees, duties] = await Promise.all([
      prisma.employee.findMany({ where: { companyId: ctx.companyId, id: { in: shift.assignments.map((row) => row.employeeId) } }, select: { id: true, name: true, employeeId: true } }),
      prisma.millingShiftDuty.findMany({ where: { companyId: ctx.companyId }, select: { id: true, name: true } }),
    ]);
    return result(
      shift.assignments.map((row): ReportRow => {
        const person = employees.find((employee) => employee.id === row.employeeId);
        return {
          id: row.id,
          shiftId: shift.id,
          name: person?.name ?? null,
          number: person?.employeeId ?? null,
          duty: duties.find((duty) => duty.id === row.dutyId)?.name ?? null,
          attendance: ATTENDANCE_WORD[row.attendance] ?? row.attendance,
          reason: row.absenceReason,
          clock: row.clockIn ? `${clock(row.clockIn)}${row.clockOut ? `–${clock(row.clockOut)}` : ""}` : null,
          breakMinutes: row.breakMinutes,
          overtime: Number(row.overtimeHours) || null,
        };
      }),
    );
  },
};

const MACHINE_STATE: Record<string, string> = { AVAILABLE: "Available", DOWN: "Down", IN_REPAIR: "In repair", AWAITING_RELEASE: "To release" };

/** Maintenance › Machine release: every machine at the mill, its state and its open stop. */
const machines: ReportLoader = {
  load: async (ctx) => {
    const site = await millSite(prisma, ctx.companyId);
    if (!site) return result([]);
    await followWorkshop(prisma, ctx.companyId);
    const [equipment, states, open] = await Promise.all([
      prisma.equipment.findMany({ where: { siteId: site.id, isActive: true }, select: { id: true, equipmentCode: true, name: true, category: true }, orderBy: { equipmentCode: "asc" } }),
      prisma.millingEquipmentState.findMany({ where: { companyId: ctx.companyId } }),
      prisma.millingDowntime.findMany({ where: { companyId: ctx.companyId, endedAt: null } }),
    ]);
    return result(
      equipment.map((row): ReportRow => {
        const key = states.find((state) => state.equipmentId === row.id)?.availability ?? "AVAILABLE";
        const stop = open.find((entry) => entry.equipmentId === row.id);
        return {
          id: row.id,
          code: row.equipmentCode,
          name: row.name,
          category: row.category ? row.category.charAt(0) + row.category.slice(1).toLowerCase().replace(/_/g, " ") : null,
          stateKey: key,
          state: MACHINE_STATE[key] ?? key,
          stop: stop?.cause ?? null,
          since: stop ? dayAndTime(stop.startedAt) : null,
        };
      }),
    );
  },
  options: async (ctx) => {
    const site = await millSite(prisma, ctx.companyId);
    const rows = site ? await prisma.equipment.findMany({ where: { siteId: site.id, isActive: true }, select: { category: true }, distinct: ["category"] }) : [];
    return { category: distinct(rows.map((row) => (row.category ? row.category.charAt(0) + row.category.slice(1).toLowerCase().replace(/_/g, " ") : null))) };
  },
};

const UNIT: Record<string, string> = { KILOGRAM: "kg", TONNE: "t", BAG: "bags", EACH: "each", LITRE: "L" };

/** Stores › Lots and bins: a row for each lot in each place it is kept. */
const lots: ReportLoader = {
  load: async (ctx) => {
    const { products } = await stockOnHand(prisma, ctx.companyId);
    return result(
      products.flatMap((product) =>
        product.lots.flatMap((lot) =>
          lot.balances.map(
            (balance): ReportRow => ({
              id: `${lot.id}~${balance.stockLocationId}`,
              lotId: lot.id,
              code: lot.code,
              product: product.name,
              category: product.category,
              place: balance.location,
              stateKey: lot.status,
              state: LOT_STATE[lot.status] ?? lot.status,
              onHand: balance.quantity,
              unit: UNIT[product.unit] ?? "",
              reserved: balance.reserved || null,
              free: Math.max(0, balance.quantity - balance.reserved),
              made: isoDay(lot.producedAt),
              producedAt: new Date(lot.producedAt).toISOString(),
            }),
          ),
        ),
      ),
    );
  },
  options: async (ctx) => {
    const { products } = await stockOnHand(prisma, ctx.companyId);
    return {
      product: distinct(products.filter((product) => product.lots.length).map((product) => product.name)),
      place: distinct(products.flatMap((product) => product.lots.flatMap((lot) => lot.balances.map((balance) => balance.location)))),
      category: distinct(products.map((product) => product.category)),
    };
  },
};

const MOVE_REASON: Record<string, string> = {
  RECEIPT: "Received",
  TRANSFER: "Moved",
  PRODUCTION_ISSUE: "Into a run",
  PRODUCTION_OUTPUT: "Out of a run",
  PACK_ISSUE: "Into packing",
  PACK_OUTPUT: "Packed",
  DESPATCH: "Despatched",
  DELIVERY_RETURN: "Returned",
  COUNT_ADJUSTMENT: "Counted",
  QC_DISPOSAL: "Disposed of",
  SELLER_SALE: "Sold by a seller",
  GATE_SALE: "Sold at the gate",
  OPENING: "Opening stock",
};

/** Stores › Lot movements: every movement of every lot, or of one lot. */
const lotMovements: ReportLoader = {
  load: async (ctx, params) => {
    const rows = await prisma.millingLotMovement.findMany({
      where: { companyId: ctx.companyId, ...(params.lot ? { lotId: params.lot } : {}) },
      orderBy: { createdAt: "desc" },
      take: 5000,
      include: { lot: { select: { code: true, productId: true } } },
    });
    const [places, products, names] = await Promise.all([
      locationCodes(ctx.companyId),
      prisma.product.findMany({ where: { companyId: ctx.companyId, id: { in: [...new Set(rows.map((row) => row.lot.productId))] } }, select: { id: true, name: true } }),
      userNames(ctx.companyId, rows.map((row) => row.createdById)),
    ]);
    return result(
      rows.map(
        (row): ReportRow => ({
          id: row.id,
          lotId: row.lotId,
          lot: row.lot.code,
          product: products.find((product) => product.id === row.lot.productId)?.name ?? null,
          reason: MOVE_REASON[row.reason] ?? row.reason.charAt(0) + row.reason.slice(1).toLowerCase().replace(/_/g, " "),
          route: `${row.fromLocationId ? (places.get(row.fromLocationId) ?? "?") : "—"} → ${row.toLocationId ? (places.get(row.toLocationId) ?? "?") : "—"}`,
          quantity: Number(row.quantity),
          how: row.isEstimated ? "Estimated" : "Weighed",
          by: names.get(row.createdById) ?? null,
          when: dayAndTime(row.createdAt),
          at: row.createdAt.toISOString(),
          date: isoDay(row.createdAt),
        }),
      ),
    );
  },
  options: async (ctx) => {
    const rows = await prisma.millingLotMovement.findMany({ where: { companyId: ctx.companyId }, select: { reason: true }, distinct: ["reason"] });
    return { reason: distinct(rows.map((row) => MOVE_REASON[row.reason] ?? row.reason.charAt(0) + row.reason.slice(1).toLowerCase().replace(/_/g, " "))) };
  },
  parentLabel: async (ctx, filters) => {
    if (!filters.lot) return null;
    const lot = await prisma.millingLot.findFirst({ where: { id: filters.lot, companyId: ctx.companyId }, select: { code: true } });
    return lot ? `Movements of ${lot.code}` : null;
  },
};

const COUNT_STATE: Record<string, string> = { POSTED: "Posted", AWAITING_DECISION: "Waiting for a decision", DISCARDED: "Discarded", OPEN: "Open" };

/** Stores › Lot counts. */
const lotCounts: ReportLoader = {
  load: async (ctx) => {
    const rows = await prisma.millingStockCount.findMany({ where: { companyId: ctx.companyId }, orderBy: { countedAt: "desc" }, take: 2000, include: { lines: true } });
    const places = await prisma.stockLocation.findMany({ where: { site: { companyId: ctx.companyId } }, select: { id: true, code: true, name: true } });
    return result(
      rows.map((row): ReportRow => {
        const place = places.find((entry) => entry.id === row.stockLocationId);
        const off = row.lines.filter((line) => Math.abs(Number(line.counted) - Number(line.expected)) > 0.0005).length;
        return {
          id: row.id,
          code: row.code,
          place: place ? `${place.code} · ${place.name}` : null,
          when: dayAndTime(row.countedAt),
          lots: row.lines.length,
          off: off || null,
          state: COUNT_STATE[row.status] ?? row.status,
          countedAt: row.countedAt.toISOString(),
          date: isoDay(row.countedAt),
        };
      }),
    );
  },
};

/** Each mill settings list: its rows, values written as the list shows them. */
const settingsLoaders: Record<string, ReportLoader> = Object.fromEntries(
  SETTINGS_RESOURCES.map((resource) => [
    `milling-setting-${resource.key}`,
    {
      load: async (ctx) => {
        const { rows, options } = (await listSettings(prisma, ctx.companyId, resource.key)) as { rows: Array<Record<string, unknown> & { id: string }>; options: Record<string, Array<{ value: string; label: string }>> };
        return result(
          rows.map((row): ReportRow => {
            const out: ReportRow = { id: row.id };
            for (const field of resource.fields) {
              const raw = row[field.key];
              out[field.key] =
                field.type === "boolean"
                  ? raw ? "Yes" : "No"
                  : field.type === "list"
                    ? Array.isArray(raw) ? raw.join(", ") : null
                    : field.type === "select"
                      ? ((field.options as Array<{ value: string; label: string }> | undefined) ?? options[field.key] ?? []).find((option) => option.value === raw)?.label ?? null
                      : field.type === "number"
                        ? raw === null || raw === undefined ? null : Number(raw)
                        : raw === null || raw === undefined ? null : String(raw);
            }
            // A recipe's bulk product reads as its name; a check's limits as one rule (lib/milling/settings/form.ts).
            if (resource.key === "recipes" && row.bulk) out.bulkProductId = String(row.bulk);
            if (resource.key === "qc-specs") out.passingRule = passingRule(row);
            return out;
          }),
        );
      },
    } satisfies ReportLoader,
  ]),
);

/** Waiting for you: what this person's groups let them decide, through the same reader as the Overview. */
const waiting: ReportLoader = {
  load: async (ctx) => {
    const access = await loadMillAccess({ id: ctx.userId, companyId: ctx.companyId, role: ctx.role });
    const rows = await waitingFor(prisma, ctx.companyId, access);
    return result(
      rows.map(
        (row): ReportRow => ({
          id: row.key,
          code: row.code,
          what: row.what,
          kindKey: row.bulk?.kind ?? "other",
          href: row.href,
          sentBy: row.sentBy,
          sent: isoDay(row.sentAt),
          sentAt: row.sentAt.toISOString(),
          quantity: row.quantity,
        }),
      ),
    );
  },
  options: async (ctx) => {
    const access = await loadMillAccess({ id: ctx.userId, companyId: ctx.companyId, role: ctx.role });
    return { what: distinct((await waitingFor(prisma, ctx.companyId, access)).map((row) => row.what)) };
  },
};

/** Settings › Who does what: everyone who can sign in and their mill groups. */
const groupMembers: ReportLoader = {
  load: async (ctx) => {
    const members = await listMillMembers(prisma, ctx.companyId);
    const name = (code: string) => MILL_GROUPS.find((group) => group.code === code)?.name ?? code;
    return result(
      members.map(
        (row): ReportRow => ({
          id: row.userId,
          name: row.name,
          email: row.email,
          groups: row.groups.map(name).join(", ") || null,
          count: row.groups.length,
          access: !row.isActive ? "Removed" : row.role === "SUPERADMIN" || row.role === "MANAGER" ? "Everything" : "Active",
        }),
      ),
    );
  },
};

const STEP_STATE: Record<string, string> = { DONE: "Done", STARTED: "Started", WAITING: "Waiting", NOT_STARTED: "Not started" };

/** Go-live: the seven steps, through the same reader as the go-live API. */
const goLive: ReportLoader = {
  load: async (ctx) =>
    result(
      (await goLiveSteps(prisma, ctx.companyId)).map(
        (row, index): ReportRow => ({ id: row.key, order: index + 1, step: row.step, layer: row.layer, owner: row.owner, stateKey: row.state, state: STEP_STATE[row.state] ?? row.state, detail: row.detail, href: row.href }),
      ),
    ),
};

/** Go-live › Opening stock: the counts on the current opening stock. */
const openingLines: ReportLoader = {
  load: async (ctx) => {
    const opening = await currentOpening(prisma, { companyId: ctx.companyId, userId: ctx.userId });
    if (!opening) return result([]);
    const view = await openingView(prisma, { companyId: ctx.companyId, userId: ctx.userId, openingId: opening.id });
    const unit: Record<string, string> = { KILOGRAM: "kg", BAG: "bags", TONNE: "t", LITRE: "L", EACH: "each" };
    return result(
      view.lines.map(
        (line): ReportRow => ({
          id: line.id,
          openingId: opening.id,
          product: line.product,
          place: line.place,
          counted: `${line.quantity.toLocaleString("en-GB")} ${unit[line.unit ?? ""] ?? ""}`.trim(),
          unitCost: line.unitCost,
          value: line.value,
          postedKey: line.posted ? "yes" : "no",
        }),
      ),
    );
  },
};

const PAID: Record<string, string> = { CASH: "Cash", ECOCASH: "EcoCash", ON_ACCOUNT: "On account" };

/** Sales: every sale at the mill's till, with where it was sold and whether Books has it. */
const sales: ReportLoader = {
  load: async (ctx) => {
    const rows = await prisma.millingSale.findMany({ where: { companyId: ctx.companyId }, include: { lines: { select: { bags: true } }, trip: { select: { code: true } } }, orderBy: { soldAt: "desc" }, take: 5000 });
    const names = await userNames(ctx.companyId, rows.map((row) => row.soldById));
    return result(
      rows.map((row): ReportRow => {
        const booksKey = row.status === "VOIDED" ? "VOIDED" : row.source === "TRIP" ? "TRIP" : row.postedAt ? "POSTED" : "TO_POST";
        return {
          id: row.id,
          code: row.code,
          where: row.source === "TRIP" ? "On the road" : "At the office",
          trip: row.trip?.code ?? null,
          customer: row.customerName ?? (row.source === "TRIP" ? `Sold on ${row.trip?.code ?? "a trip"}` : "Walk-in"),
          seller: names.get(row.soldById) ?? null,
          bags: row.lines.reduce((sum, line) => sum + line.bags, 0),
          total: Number(row.totalAmount),
          payment: PAID[row.payment] ?? row.payment,
          stateKey: row.status,
          booksKey,
          books: { VOIDED: "Voided", TRIP: "With its trip", POSTED: "Posted", TO_POST: "To post" }[booksKey],
          time: dayAndTime(row.soldAt),
          soldAt: row.soldAt.toISOString(),
          date: isoDay(row.soldAt),
        };
      }),
    );
  },
  options: async (ctx) => {
    const rows = await prisma.millingSale.findMany({ where: { companyId: ctx.companyId }, select: { soldById: true }, distinct: ["soldById"] });
    const names = await userNames(ctx.companyId, rows.map((row) => row.soldById));
    return { seller: distinct([...names.values()]) };
  },
};

export const MILLING_LIST_LOADERS: Record<string, ReportLoader> = {
  ...settingsLoaders,
  "milling-trip-list": trips,
  "milling-intake-list": intake,
  "milling-exception-list": exceptions,
  "milling-waiting": waiting,
  "milling-sale-list": sales,
  "milling-setting-groups": groupMembers,
  "milling-go-live": goLive,
  "milling-opening-lines": openingLines,
  "milling-run-list": runs,
  "milling-packing-list": packing,
  "milling-test-list": tests,
  "milling-despatch-list": despatches,
  "milling-route-list": routes,
  "milling-order-list": orders,
  "milling-plan-list": plans,
  "milling-shift-list": shifts,
  "milling-customer-list": customers,
  "milling-visit-list": visits,
  "milling-survey-list": visits,
  "milling-downtime-list": downtime,
  "milling-generator-list": generator,
  "milling-delivery-lines": stops,
  "milling-customer-invoices": customerInvoices,
  "milling-customer-despatches": customerDespatches,
  "milling-route-stops": routeStops,
  "milling-qc-results": qcResults,
  "milling-run-stages": runStages,
  "milling-run-maize": runMaize,
  "milling-run-outputs": runOutputs,
  "milling-plan-lines": planLines,
  "milling-machine-list": machines,
  "milling-lot-list": lots,
  "milling-lot-movement-list": lotMovements,
  "milling-lot-count-list": lotCounts,
  "milling-shift-crew": shiftCrew,
  "milling-seller-list": sellers,
  "milling-seller-trip-list": sellerTrips,
  "milling-seller-commission-list": sellerCommission,
  "milling-seller-payment-list": sellerPayments,
};
