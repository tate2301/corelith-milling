import { prisma } from "@/lib/prisma";
import { dateRange } from "@/lib/reports/params";
import { REPORT_ROW_LIMIT, type ReportLoader, type ReportParams, type ReportRow } from "@/lib/reports/types";

import { dailyOperations } from "@/lib/milling/reports/daily";

/**
 * Loaders for `./reports.ts`. Server-only: registered in `extensions/server.ts`.
 * Each reads the company's own mill records in the period asked for.
 */

const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const day = (value: Date | null | undefined) => (value ? value.toISOString().slice(0, 10) : null);
const capped = (rows: ReportRow[]) => ({ rows: rows.slice(0, REPORT_ROW_LIMIT), truncated: rows.length > REPORT_ROW_LIMIT });

function period(params: ReportParams) {
  return dateRange(params);
}

const METHOD: Record<string, string> = { BAG_COUNT: "Bag count", EXTERNAL_TICKET: "Weighbridge ticket", SUPPLIER_DECLARED: "Supplier's weight" };

export const MILLING_LOADERS: Record<string, ReportLoader> = {
  "milling-daily-operations": {
    load: async (ctx, params) => {
      const when = params.day ? new Date(`${params.day}T00:00:00.000Z`) : new Date(Date.now() - 86_400_000);
      const rows = await dailyOperations(prisma, ctx.companyId, when);
      return { rows: rows.map((row, index) => ({ id: String(index), ...row })), truncated: false };
    },
  },

  "milling-intake": {
    load: async (ctx, params) => {
      const intakes = await prisma.millingIntake.findMany({ where: { companyId: ctx.companyId, receivedAt: period(params) }, orderBy: { receivedAt: "desc" }, take: REPORT_ROW_LIMIT + 1 });
      const inspections = await prisma.millingQcInspection.findMany({
        where: { companyId: ctx.companyId, targetType: "MillingIntake", targetId: { in: intakes.map((row) => row.id) } },
        orderBy: { inspectedAt: "desc" },
        include: { results: { where: { specCode: "MOISTURE" } } },
      });
      return capped(
        intakes.map((row) => {
          const last = inspections.find((inspection) => inspection.targetId === row.id);
          return {
            id: row.id,
            date: day(row.receivedAt),
            code: row.code,
            supplier: row.supplierName,
            method: METHOD[row.weighMethod] ?? row.weighMethod,
            weightStatus: row.weightStatus,
            netKg: num(row.netKg),
            moisture: num(last?.results[0]?.value),
            outcome: last?.outcome ?? null,
            status: row.status,
          };
        }),
      );
    },
  },

  "milling-production": {
    load: async (ctx, params) => {
      const batches = await prisma.millingBatch.findMany({ where: { companyId: ctx.companyId, startedAt: period(params) }, orderBy: { startedAt: "desc" }, take: REPORT_ROW_LIMIT + 1, include: { outputs: true, stages: true } });
      return capped(
        batches.map((batch) => ({
          id: batch.id,
          date: day(batch.startedAt),
          code: batch.code,
          maizeKg: num(batch.maizeIssuedKg),
          waterKg: num(batch.waterAddedKg),
          outputKg: num(batch.outputKg) ?? batch.outputs.reduce((sum, row) => sum + Number(row.quantityKg), 0),
          separatedKg: num(batch.separatedKg) ?? batch.stages.reduce((sum, row) => sum + Number(row.removedKg ?? 0), 0),
          unaccountedKg: num(batch.unaccountedKg),
          variancePct: num(batch.variancePct),
          maizeCost: num(batch.maizeCost),
          status: batch.status,
        })),
      );
    },
  },

  "milling-yields": {
    load: async (ctx, params) => {
      const batches = await prisma.millingBatch.findMany({ where: { companyId: ctx.companyId, startedAt: period(params) }, include: { outputs: true }, take: 2000 });
      const outputs = batches.flatMap((batch) => batch.outputs.map((output) => ({ batch, output })));
      const [products, lots] = await Promise.all([
        prisma.product.findMany({ where: { companyId: ctx.companyId, id: { in: outputs.map((row) => row.output.productId) } }, select: { id: true, name: true } }),
        prisma.millingLot.findMany({ where: { id: { in: outputs.map((row) => row.output.lotId) } }, select: { id: true, code: true, status: true } }),
      ]);
      return capped(
        outputs.map(({ batch, output }) => ({
          id: output.id,
          date: day(batch.startedAt),
          batch: batch.code,
          product: products.find((product) => product.id === output.productId)?.name ?? "",
          kg: num(output.quantityKg),
          yieldPct: batch.maizeIssuedKg.isZero() ? null : Math.round(output.quantityKg.div(batch.maizeIssuedKg).times(10000).toNumber()) / 100,
          lot: lots.find((lot) => lot.id === output.lotId)?.code ?? null,
          qc: lots.find((lot) => lot.id === output.lotId)?.status ?? null,
        })),
      );
    },
  },

  "milling-qc": {
    load: async (ctx, params) => {
      const inspections = await prisma.millingQcInspection.findMany({ where: { companyId: ctx.companyId, inspectedAt: period(params) }, include: { results: true }, orderBy: { inspectedAt: "desc" }, take: 2000 });
      const intakes = await prisma.millingIntake.findMany({ where: { id: { in: inspections.filter((row) => row.targetType === "MillingIntake").map((row) => row.targetId) } }, select: { id: true, code: true } });
      const lots = await prisma.millingLot.findMany({ where: { id: { in: inspections.filter((row) => row.targetType === "MillingLot").map((row) => row.targetId) } }, select: { id: true, code: true } });
      const label = (type: string, id: string) => (type === "MillingIntake" ? intakes.find((row) => row.id === id)?.code : lots.find((row) => row.id === id)?.code) ?? id.slice(0, 8);
      return capped(
        inspections.flatMap((inspection) =>
          inspection.results.map((result) => ({
            id: result.id,
            date: day(inspection.inspectedAt),
            point: inspection.point === "INCOMING_MAIZE" ? "Incoming maize" : "Finished product",
            target: label(inspection.targetType, inspection.targetId),
            check: `${result.specName} v${result.specVersion}`,
            method: result.method === "NOT_PERFORMED" ? "Not performed" : result.method === "INSTRUMENT" ? "Instrument" : "Visual",
            value: num(result.value),
            result: result.passed === null ? "NOT_PERFORMED" : result.passed ? "PASS" : "FAIL",
          })),
        ),
      );
    },
  },

  "milling-packing": {
    load: async (ctx, params) => {
      const runs = await prisma.millingPackRun.findMany({ where: { companyId: ctx.companyId, packedAt: period(params) }, orderBy: { packedAt: "desc" }, take: REPORT_ROW_LIMIT + 1 });
      const recipes = await prisma.millingPackRecipe.findMany({ where: { companyId: ctx.companyId } });
      const products = await prisma.product.findMany({ where: { companyId: ctx.companyId, id: { in: recipes.map((recipe) => recipe.packedProductId) } }, select: { id: true, name: true } });
      return capped(
        runs.map((run) => ({
          id: run.id,
          date: day(run.packedAt),
          code: run.code,
          product: products.find((product) => product.id === recipes.find((recipe) => recipe.id === run.recipeId)?.packedProductId)?.name ?? "",
          bags: run.bagsPacked,
          damaged: run.damagedBags,
          bulkKg: num(run.bulkUsedKg),
          giveawayKg: num(run.varianceKg),
        })),
      );
    },
  },

  "milling-downtime": {
    load: async (ctx, params) => {
      const stops = await prisma.millingDowntime.findMany({ where: { companyId: ctx.companyId, startedAt: period(params) }, orderBy: { startedAt: "desc" }, take: REPORT_ROW_LIMIT + 1 });
      const machines = await prisma.equipment.findMany({ where: { id: { in: stops.map((stop) => stop.equipmentId).filter((id): id is string => Boolean(id)) } }, select: { id: true, equipmentCode: true, name: true } });
      const now = Date.now();
      return capped(
        stops.map((stop) => {
          const machine = machines.find((entry) => entry.id === stop.equipmentId);
          return {
            id: stop.id,
            date: day(stop.startedAt),
            machine: machine ? `${machine.equipmentCode} ${machine.name}` : "The line",
            category: stop.category,
            cause: stop.cause,
            hours: Math.round((((stop.endedAt?.getTime() ?? now) - stop.startedAt.getTime()) / 3_600_000) * 100) / 100,
            open: stop.endedAt ? "No" : "Yes",
          };
        }),
      );
    },
  },

  "milling-generator": {
    load: async (ctx, params) => {
      const [runs, trips] = await Promise.all([
        prisma.millingGeneratorRun.findMany({ where: { companyId: ctx.companyId, startedAt: period(params) }, orderBy: { startedAt: "desc" } }),
        prisma.millingDelivery.findMany({ where: { companyId: ctx.companyId, dispatchedAt: period(params), status: "CLOSED" }, orderBy: { dispatchedAt: "desc" } }),
      ]);
      const vehicles = await prisma.equipment.findMany({ where: { id: { in: trips.map((trip) => trip.vehicleId) } }, select: { id: true, name: true } });
      return capped([
        ...runs.map((run) => ({
          id: run.id,
          date: day(run.startedAt),
          use: "Generator",
          hours: Math.round(((run.endedAt.getTime() - run.startedAt.getTime()) / 3_600_000) * 100) / 100,
          km: null,
          litres: num(run.litres),
          reason: run.reason,
        })),
        ...trips.map((trip) => ({
          id: trip.id,
          date: day(trip.dispatchedAt),
          use: vehicles.find((vehicle) => vehicle.id === trip.vehicleId)?.name ?? "Truck",
          hours: null,
          km: trip.odometerIn && trip.odometerOut ? Number(trip.odometerIn.minus(trip.odometerOut)) : null,
          litres: num(trip.fuelLitres),
          reason: trip.code,
        })),
      ]);
    },
  },

  "milling-stock": {
    load: async (ctx) => {
      const balances = await prisma.millingLotBalance.findMany({ where: { companyId: ctx.companyId, quantity: { gt: 0 } }, include: { lot: true } });
      const [products, locations] = await Promise.all([
        prisma.product.findMany({ where: { companyId: ctx.companyId }, select: { id: true, name: true, category: true, unit: true, unitLabel: true, netWeightKg: true } }),
        prisma.stockLocation.findMany({ where: { site: { companyId: ctx.companyId } }, select: { id: true, code: true } }),
      ]);
      return capped(
        balances.map((balance) => {
          const product = products.find((entry) => entry.id === balance.lot.productId);
          const quantity = Number(balance.quantity);
          return {
            id: balance.id,
            category: product?.category ?? "Other",
            product: product?.name ?? "",
            lot: balance.lot.code,
            location: locations.find((location) => location.id === balance.stockLocationId)?.code ?? "",
            status: balance.lot.status,
            quantity,
            unit: product?.unit === "KILOGRAM" ? "kg" : product?.unit === "BAG" ? "bags" : product?.unit === "OTHER" ? product.unitLabel ?? "" : "each",
            kg: product?.unit === "KILOGRAM" ? quantity : product?.netWeightKg ? quantity * Number(product.netWeightKg) : null,
          };
        }),
      );
    },
  },

  "milling-stock-reconciliation": {
    load: async (ctx, params) => {
      const range = period(params);
      const [products, movements] = await Promise.all([
        prisma.product.findMany({ where: { companyId: ctx.companyId, kind: { in: ["GOODS", "MATERIAL"] } }, select: { id: true, name: true, category: true, unit: true, unitLabel: true } }),
        prisma.millingLotMovement.findMany({ where: { companyId: ctx.companyId, ...(range?.lte ? { createdAt: { lte: range.lte } } : {}) }, select: { quantity: true, reason: true, fromLocationId: true, toLocationId: true, createdAt: true, lot: { select: { productId: true } } } }),
      ]);
      const from = range?.gte?.getTime() ?? 0;
      const rows = new Map<string, { opening: number; received: number; issued: number; adjusted: number }>();
      for (const movement of movements) {
        if (movement.reason === "BIN_MOVE") continue;
        const signed = movement.toLocationId && !movement.fromLocationId ? Number(movement.quantity) : -Number(movement.quantity);
        const row = rows.get(movement.lot.productId) ?? { opening: 0, received: 0, issued: 0, adjusted: 0 };
        if (movement.createdAt.getTime() < from) row.opening += signed;
        else if (movement.reason === "COUNT_ADJUSTMENT" || movement.reason === "WEIGHT_CORRECTION") row.adjusted += signed;
        else if (signed > 0) row.received += signed;
        else row.issued += -signed;
        rows.set(movement.lot.productId, row);
      }
      return capped(
        [...rows.entries()].map(([productId, row]) => {
          const product = products.find((entry) => entry.id === productId);
          return {
            id: productId,
            category: product?.category ?? "Other",
            product: product?.name ?? "",
            opening: Math.round(row.opening * 1000) / 1000,
            received: Math.round(row.received * 1000) / 1000,
            issued: Math.round(row.issued * 1000) / 1000,
            adjusted: Math.round(row.adjusted * 1000) / 1000,
            closing: Math.round((row.opening + row.received - row.issued + row.adjusted) * 1000) / 1000,
            unit: product?.unit === "KILOGRAM" ? "kg" : product?.unit === "BAG" ? "bags" : product?.unit === "OTHER" ? product.unitLabel ?? "" : "each",
          };
        }),
      );
    },
  },

  "milling-despatches": {
    load: async (ctx, params) => {
      const lines = await despatchLines(ctx.companyId, params);
      return capped(lines);
    },
  },

  "milling-despatch-daily": {
    load: async (ctx, params) => {
      const lines = await despatchLines(ctx.companyId, params);
      const byDay = new Map<string, { date: string; product: string; bags: number; tonnes: number; value: number }>();
      for (const line of lines) {
        const key = `${line.date}|${line.product}`;
        const row = byDay.get(key) ?? { date: String(line.date), product: String(line.product), bags: 0, tonnes: 0, value: 0 };
        row.bags += Number(line.delivered ?? line.bags);
        row.tonnes += Number(line.tonnes);
        row.value += Number(line.value ?? 0);
        byDay.set(key, row);
      }
      return capped([...byDay.entries()].map(([key, row]) => ({ id: key, ...row, tonnes: Math.round(row.tonnes * 1000) / 1000 })));
    },
  },

  "milling-trips": {
    load: async (ctx, params) => {
      const trips = await prisma.millingDelivery.findMany({ where: { companyId: ctx.companyId, dispatchedAt: period(params) }, orderBy: { dispatchedAt: "desc" }, take: REPORT_ROW_LIMIT + 1 });
      const [vehicles, drivers, destinations] = await Promise.all([
        prisma.equipment.findMany({ where: { id: { in: trips.map((trip) => trip.vehicleId) } }, select: { id: true, name: true } }),
        prisma.user.findMany({ where: { companyId: ctx.companyId, id: { in: trips.map((trip) => trip.driverId).filter((id): id is string => Boolean(id)) } }, select: { id: true, name: true } }),
        prisma.millingDestination.findMany({ where: { companyId: ctx.companyId } }),
      ]);
      return capped(
        trips.map((trip) => ({
          id: trip.id,
          date: day(trip.dispatchedAt),
          vehicle: vehicles.find((vehicle) => vehicle.id === trip.vehicleId)?.name ?? "",
          driver: drivers.find((driver) => driver.id === trip.driverId)?.name ?? null,
          destination: destinations.find((destination) => destination.id === trip.destinationId)?.name ?? null,
          delivery: trip.code,
          loadKg: num(trip.loadKg),
          km: trip.odometerIn && trip.odometerOut ? Number(trip.odometerIn.minus(trip.odometerOut)) : null,
          litres: num(trip.fuelLitres),
          status: trip.status,
        })),
      );
    },
  },

  "milling-attendance": {
    load: async (ctx, params) => {
      const shifts = await prisma.millingShift.findMany({ where: { companyId: ctx.companyId, scheduledStart: period(params) }, include: { assignments: true }, orderBy: { scheduledStart: "desc" } });
      const assignments = shifts.flatMap((shift) => shift.assignments.map((assignment) => ({ shift, assignment })));
      const [employees, duties] = await Promise.all([
        prisma.employee.findMany({ where: { companyId: ctx.companyId, id: { in: assignments.map((row) => row.assignment.employeeId) } }, select: { id: true, name: true } }),
        prisma.millingShiftDuty.findMany({ where: { companyId: ctx.companyId } }),
      ]);
      return capped(
        assignments.map(({ shift, assignment }) => ({
          id: assignment.id,
          date: day(shift.scheduledStart),
          shift: shift.code,
          employee: employees.find((employee) => employee.id === assignment.employeeId)?.name ?? "",
          duty: duties.find((duty) => duty.id === assignment.dutyId)?.name ?? null,
          attendance: assignment.attendance,
          overtime: num(assignment.overtimeHours),
          reason: assignment.absenceReason,
        })),
      );
    },
  },
};

async function despatchLines(companyId: string, params: ReportParams): Promise<ReportRow[]> {
  const deliveries = await prisma.millingDelivery.findMany({ where: { companyId, dispatchedAt: period(params) }, include: { lines: true }, orderBy: { dispatchedAt: "desc" }, take: 2000 });
  const lines = deliveries.flatMap((delivery) => delivery.lines.map((line) => ({ delivery, line })));
  const [orders, orderLines, customers, destinations, products] = await Promise.all([
    prisma.millingCustomerOrder.findMany({ where: { companyId, id: { in: lines.map((row) => row.line.orderId) } }, select: { id: true, customerId: true } }),
    prisma.millingCustomerOrderLine.findMany({ where: { id: { in: lines.map((row) => row.line.orderLineId) } }, select: { id: true, unitPrice: true } }),
    prisma.customer.findMany({ where: { companyId }, select: { id: true, name: true } }),
    prisma.millingDestination.findMany({ where: { companyId } }),
    prisma.product.findMany({ where: { companyId, id: { in: lines.map((row) => row.line.productId) } }, select: { id: true, name: true, netWeightKg: true } }),
  ]);
  return lines.map(({ delivery, line }) => {
    const product = products.find((entry) => entry.id === line.productId);
    const bags = line.deliveredBags ?? line.bags;
    const price = orderLines.find((row) => row.id === line.orderLineId)?.unitPrice;
    return {
      id: line.id,
      date: day(delivery.dispatchedAt),
      delivery: delivery.code,
      customer: customers.find((customer) => customer.id === orders.find((order) => order.id === line.orderId)?.customerId)?.name ?? "",
      destination: destinations.find((destination) => destination.id === delivery.destinationId)?.name ?? null,
      product: product?.name ?? "",
      bags: line.bags,
      tonnes: product?.netWeightKg ? Math.round(bags * Number(product.netWeightKg)) / 1000 : null,
      delivered: line.deliveredBags,
      short: line.shortBags,
      returned: line.returnedBags,
      value: price ? Math.round(Number(price) * bags * 100) / 100 : null,
      status: delivery.status,
    };
  });
}
