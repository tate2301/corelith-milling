import type { PrismaClient } from "@prisma/client";

import { can, type MillAccess } from "../access/groups";
import type { BulkAction, BulkKind } from "./decide-many";
import { millDay } from "../sellers/trips";
import { millSite } from "../stock/views";
import { millDayWindow } from "./daily";

/**
 * The Mill Manager's Overview (canvas HM-A1): what is waiting for this
 * person's decision, then yesterday across the sites.
 *
 * "Waiting for you" lists only what the person's groups let them decide; each
 * row opens the record, where the decision is taken with its own checks.
 */

type Db = PrismaClient;

export interface WaitingRow {
  key: string;
  code: string;
  what: string;
  href: string;
  sentById: string | null;
  sentBy: string | null;
  sentAt: Date;
  quantity: string | null;
  /** Set when the decision is one press, so the row can be chosen with others (plans, shifts). */
  bulk?: { kind: BulkKind; actions: BulkAction[] };
}

const kg = (value: unknown) => `${Number(value).toLocaleString("en-ZW", { maximumFractionDigits: 1 })} kg`;

export async function waitingFor(db: Db, companyId: string, access: Pick<MillAccess, "capabilities">): Promise<WaitingRow[]> {
  const today = millDay();
  const [plans, runs, intakes, exceptions, shifts, deliveries, trips, held] = await Promise.all([
    can(access, "plan.approve") ? db.millingProductionOrder.findMany({ where: { companyId, status: "SUBMITTED" }, include: { lines: true }, take: 50 }) : [],
    can(access, "batch.approve") ? db.millingBatch.findMany({ where: { companyId, status: "AWAITING_DECISION" }, take: 50 }) : [],
    can(access, "qc.decide") ? db.millingIntake.findMany({ where: { companyId, status: "AWAITING_QC" }, take: 50 }) : [],
    can(access, "exception.decide") ? db.millingException.findMany({ where: { companyId, status: "OPEN" }, take: 50 }) : [],
    can(access, "shift.approve") ? db.millingShift.findMany({ where: { companyId, status: "CLOSED" }, take: 50 }) : [],
    can(access, "delivery.manage") ? db.millingDelivery.findMany({ where: { companyId, status: "DELIVERED" }, take: 50 }) : [],
    can(access, "seller.manage") ? db.millingSellerTrip.findMany({ where: { companyId, status: "OUT", tripDate: { lt: today } }, take: 50 }) : [],
    // Lots made or received and held until QC releases them.
    can(access, "qc.decide") ? db.millingLot.findMany({ where: { companyId, status: "HOLD" }, include: { balances: { select: { quantity: true } } }, take: 50 }) : [],
  ]);
  const heldUnits = held.length ? await db.product.findMany({ where: { id: { in: held.map((row) => row.productId) } }, select: { id: true, unit: true } }) : [];
  const rows: WaitingRow[] = [
    ...plans.map((row) => ({ key: row.id, code: row.code, what: "Production plan", href: `/milling/plan/${row.id}`, sentById: row.createdById, sentAt: row.updatedAt, quantity: kg(row.lines.reduce((sum, line) => sum + Number(line.kg), 0)), bulk: { kind: "plan" as const, actions: ["approve", "send-back"] as BulkAction[] } })),
    ...runs.map((row) => ({ key: row.id, code: row.code, what: "Run", href: `/milling/production/${row.id}`, sentById: row.completedById ?? row.createdById, sentAt: row.updatedAt, quantity: `${kg(row.maizeIssuedKg)} in` })),
    ...intakes.map((row) => ({ key: row.id, code: row.code, what: "Intake ticket", href: `/milling/intake/${row.id}`, sentById: row.receivedById, sentAt: row.receivedAt, quantity: kg(row.netKg) })),
    ...exceptions.map((row) => ({ key: row.id, code: row.code, what: row.title, href: "/milling/exceptions", sentById: row.raisedById, sentAt: row.createdAt, quantity: null })),
    ...shifts.map((row) => ({ key: row.id, code: row.code, what: "Shift to approve", href: `/milling/shifts/${row.id}`, sentById: row.createdById, sentAt: row.updatedAt, quantity: null, bulk: { kind: "shift" as const, actions: ["approve"] as BulkAction[] } })),
    ...deliveries.map((row) => ({ key: row.id, code: row.code, what: "Delivery to reconcile", href: `/milling/deliveries/${row.id}`, sentById: row.driverId, sentAt: row.deliveredAt ?? row.updatedAt, quantity: null })),
    ...trips.map((row) => ({ key: row.id, code: row.code, what: "Seller still out", href: "/milling/sellers", sentById: row.issuedById, sentAt: row.issuedAt, quantity: null })),
    ...held.map((row) => {
      const amount = row.balances.reduce((sum, balance) => sum + Number(balance.quantity), 0);
      const bags = heldUnits.find((product) => product.id === row.productId)?.unit === "BAG";
      return { key: row.id, code: row.code, what: "Lot on hold for QC", href: "/milling/quality", sentById: null, sentAt: row.createdAt, quantity: bags ? `${amount.toLocaleString("en-ZW")} bags` : kg(amount) };
    }),
  ].map((row) => ({ ...row, sentBy: null }));
  const people = await db.user.findMany({ where: { companyId, id: { in: rows.map((row) => row.sentById).filter((id): id is string => Boolean(id)) } }, select: { id: true, name: true } });
  return rows
    .map((row) => ({ ...row, sentBy: people.find((person) => person.id === row.sentById)?.name ?? null }))
    .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
}

export interface SiteDay {
  siteId: string;
  site: string;
  maizeKg: number | null;
  mealKg: number | null;
  downtimeHours: number | null;
  bagsOut: number | null;
}

/**
 * Yesterday, site by site: maize received and meal made at the mill, its
 * downtime, and bags that left each site, on a delivery or with a seller.
 */
export async function yesterdayBySite(db: Db, companyId: string, now: Date = new Date()) {
  const yesterday = new Date(millDay(now).getTime() - 86_400_000);
  const window = millDayWindow(yesterday);
  const [sites, intakes, outputs, stops, deliveries, trips, site, mealProducts] = await Promise.all([
    db.site.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.millingIntake.findMany({ where: { companyId, receivedAt: window, status: { not: "REJECTED" } }, select: { netKg: true } }),
    db.millingBatchOutput.findMany({ where: { batch: { companyId }, createdAt: window }, select: { quantityKg: true, productId: true } }),
    db.millingDowntime.findMany({ where: { companyId, startedAt: { lt: window.lt }, OR: [{ endedAt: null }, { endedAt: { gte: window.gte } }] }, select: { startedAt: true, endedAt: true } }),
    db.millingDelivery.findMany({ where: { companyId, dispatchedAt: window }, include: { lines: { select: { bags: true, stockLocationId: true } } } }),
    db.millingSellerTrip.findMany({ where: { companyId, tripDate: yesterday, status: "SETTLED" }, include: { lines: { select: { bagsSold: true } } } }),
    millSite(db, companyId),
    db.product.findMany({ where: { companyId, code: { startsWith: "MEAL" } }, select: { id: true } }),
  ]);
  const millSiteId = site?.id;
  const locations = await db.stockLocation.findMany({ where: { id: { in: deliveries.flatMap((row) => row.lines.map((line) => line.stockLocationId)) } }, select: { id: true, siteId: true } });
  const downtime = stops.reduce((sum, stop) => sum + (Math.min((stop.endedAt ?? window.lt).getTime(), window.lt.getTime()) - Math.max(stop.startedAt.getTime(), window.gte.getTime())) / 3_600_000, 0);
  const mealIds = new Set(mealProducts.map((row) => row.id));
  const meal = outputs.filter((row) => mealIds.has(row.productId)).reduce((sum, row) => sum + Number(row.quantityKg), 0);
  const rows: SiteDay[] = sites.map((site) => {
    const isMill = site.id === millSiteId;
    const despatched = deliveries.flatMap((row) => row.lines).filter((line) => locations.find((entry) => entry.id === line.stockLocationId)?.siteId === site.id).reduce((sum, line) => sum + line.bags, 0);
    const sold = trips.filter((trip) => trip.siteId === site.id).flatMap((trip) => trip.lines).reduce((sum, line) => sum + (line.bagsSold ?? 0), 0);
    return {
      siteId: site.id,
      site: site.name,
      maizeKg: isMill ? intakes.reduce((sum, row) => sum + Number(row.netKg), 0) : null,
      mealKg: isMill ? meal : null,
      downtimeHours: isMill ? Math.round(downtime * 10) / 10 : null,
      bagsOut: despatched + sold || null,
    };
  });
  const sum = (pick: (row: SiteDay) => number | null) => rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
  return {
    day: yesterday.toISOString().slice(0, 10),
    rows,
    total: { maizeKg: sum((row) => row.maizeKg), mealKg: sum((row) => row.mealKg), downtimeHours: Math.round(sum((row) => row.downtimeHours) * 10) / 10, bagsOut: sum((row) => row.bagsOut) },
  };
}
