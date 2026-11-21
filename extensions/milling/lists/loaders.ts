import { prisma } from "@/lib/prisma";
import { result } from "@/lib/reports/loaders/shared";
import type { ReportLoader, ReportRow } from "@/lib/reports/types";

import { targetHref } from "@/components/milling/targets";
import { listTrips } from "@/lib/milling/distribution/trips";
import { EXCEPTION_TYPES } from "@/lib/milling/exceptions/exceptions";
import { DECISION_LABEL } from "@/lib/milling/exceptions/words";

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
  load: async (ctx) => {
    const { trips: rows } = await listTrips(prisma, ctx.companyId, { take: 2000 });
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

export const MILLING_LIST_LOADERS: Record<string, ReportLoader> = {
  "milling-trip-list": trips,
  "milling-intake-list": intake,
  "milling-exception-list": exceptions,
};
