import type { PrismaClient } from "@prisma/client";

/**
 * One day at the mill, as management reads it every morning (plan v2, L5).
 * The day is the mill's calendar day (Harare, UTC+2). Rows are section,
 * measure, value and unit, so the report groups by section and the scheduled
 * email reads as a page.
 */

const HARARE_MS = 2 * 60 * 60 * 1000;

export interface DailyRow {
  section: string;
  measure: string;
  value: number | null;
  unit: string;
}

/** `day` is any moment on the wanted day in UTC terms; the window is that calendar day in Harare. */
export function millDayWindow(day: Date) {
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) - HARARE_MS);
  return { gte: start, lt: new Date(start.getTime() + 86_400_000) };
}

const round = (value: number, places = 1) => Math.round(value * 10 ** places) / 10 ** places;

export async function dailyOperations(db: PrismaClient, companyId: string, day: Date): Promise<DailyRow[]> {
  const window = millDayWindow(day);
  const [intakes, batches, packRuns, deliveries, stops, generator, openExceptions, raised, balances, products, shifts] = await Promise.all([
    db.millingIntake.findMany({ where: { companyId, receivedAt: window }, select: { netKg: true, status: true, weightStatus: true } }),
    db.millingBatch.findMany({ where: { companyId, OR: [{ startedAt: window }, { completedAt: window }] }, include: { outputs: true } }),
    db.millingPackRun.findMany({ where: { companyId, packedAt: window } }),
    db.millingDelivery.findMany({ where: { companyId, dispatchedAt: window }, include: { lines: true } }),
    db.millingDowntime.findMany({ where: { companyId, startedAt: { lt: window.lt }, OR: [{ endedAt: null }, { endedAt: { gte: window.gte } }] } }),
    db.millingGeneratorRun.findMany({ where: { companyId, startedAt: window } }),
    db.millingException.count({ where: { companyId, status: "OPEN" } }),
    db.millingException.count({ where: { companyId, createdAt: window } }),
    db.millingLotBalance.findMany({ where: { companyId, quantity: { gt: 0 } }, include: { lot: { select: { productId: true, status: true } } } }),
    db.product.findMany({ where: { companyId }, select: { id: true, code: true, name: true, category: true, unit: true, netWeightKg: true } }),
    db.millingShift.findMany({ where: { companyId, scheduledStart: window }, include: { assignments: true } }),
  ]);
  const productOf = (id: string) => products.find((product) => product.id === id);
  const rows: DailyRow[] = [];
  const add = (section: string, measure: string, value: number | null, unit: string) => rows.push({ section, measure, value, unit });

  // Intake
  add("Intake", "Deliveries received", intakes.length, "");
  add("Intake", "Maize received", round(intakes.reduce((sum, row) => sum + Number(row.netKg), 0) / 1000, 2), "t");
  add("Intake", "Weights still provisional", intakes.filter((row) => row.weightStatus === "PROVISIONAL").length, "");
  add("Intake", "Held or rejected", intakes.filter((row) => row.status === "HELD" || row.status === "REJECTED").length, "");

  // Production
  const maizeIn = batches.filter((batch) => batch.startedAt >= window.gte && batch.startedAt < window.lt).reduce((sum, batch) => sum + Number(batch.maizeIssuedKg), 0);
  add("Production", "Batches started", batches.filter((batch) => batch.startedAt >= window.gte).length, "");
  add("Production", "Batches completed", batches.filter((batch) => batch.completedAt && batch.completedAt >= window.gte).length, "");
  add("Production", "Maize milled", round(maizeIn / 1000, 2), "t");
  const outputs = new Map<string, number>();
  for (const output of batches.flatMap((batch) => batch.outputs).filter((row) => row.createdAt >= window.gte && row.createdAt < window.lt)) {
    const name = productOf(output.productId)?.name ?? "Product";
    outputs.set(name, (outputs.get(name) ?? 0) + Number(output.quantityKg));
  }
  for (const [name, kg] of outputs) add("Production", `${name} made`, round(kg / 1000, 2), "t");
  const completed = batches.filter((batch) => batch.completedAt && batch.variancePct !== null);
  if (completed.length) add("Production", "Average unaccounted", round(completed.reduce((sum, batch) => sum + Number(batch.variancePct), 0) / completed.length, 2), "%");

  // Packing
  const packed = new Map<string, number>();
  const recipes = packRuns.length ? await db.millingPackRecipe.findMany({ where: { companyId } }) : [];
  for (const run of packRuns) {
    const name = productOf(recipes.find((recipe) => recipe.id === run.recipeId)?.packedProductId ?? "")?.name ?? "Packed";
    packed.set(name, (packed.get(name) ?? 0) + run.bagsPacked);
  }
  for (const [name, bags] of packed) add("Packing", `${name} packed`, bags, "bags");
  add("Packing", "Damaged bags", packRuns.reduce((sum, run) => sum + run.damagedBags, 0), "bags");
  add("Packing", "Giveaway", round(packRuns.reduce((sum, run) => sum + Number(run.varianceKg), 0), 1), "kg");

  // People
  const crew = shifts.flatMap((shift) => shift.assignments);
  add("People", "On shift", crew.filter((row) => row.attendance === "PRESENT" || row.attendance === "LATE").length, "");
  add("People", "Absent or on leave", crew.filter((row) => row.attendance === "ABSENT" || row.attendance === "ON_LEAVE").length, "");
  add("People", "Overtime", round(crew.reduce((sum, row) => sum + Number(row.overtimeHours), 0), 2), "h");

  // Machines
  const hoursIn = (start: Date, end: Date | null) => (Math.min((end ?? new Date()).getTime(), window.lt.getTime()) - Math.max(start.getTime(), window.gte.getTime())) / 3_600_000;
  add("Machines", "Stops", stops.length, "");
  add("Machines", "Hours stopped", round(stops.reduce((sum, stop) => sum + Math.max(0, hoursIn(stop.startedAt, stop.endedAt)), 0), 2), "h");
  add("Machines", "Generator hours", round(generator.reduce((sum, run) => sum + (run.endedAt.getTime() - run.startedAt.getTime()) / 3_600_000, 0), 2), "h");
  add("Machines", "Generator diesel", round(generator.reduce((sum, run) => sum + Number(run.litres), 0), 1), "L");

  // Despatch
  const bags = deliveries.flatMap((delivery) => delivery.lines).reduce((sum, line) => sum + line.bags, 0);
  add("Despatch", "Trips", deliveries.length, "");
  add("Despatch", "Bags despatched", bags, "bags");
  add("Despatch", "Tonnes despatched", round(deliveries.reduce((sum, delivery) => sum + Number(delivery.loadKg), 0) / 1000, 2), "t");

  // Stock now
  const stock = new Map<string, number>();
  for (const balance of balances) {
    const product = productOf(balance.lot.productId);
    if (!product) continue;
    const kg = product.unit === "KILOGRAM" ? Number(balance.quantity) : null;
    const label = product.code === "MAIZE" ? `Maize ${balance.lot.status === "AVAILABLE" ? "available" : "on hold"}` : product.name;
    stock.set(label, (stock.get(label) ?? 0) + (kg !== null ? kg / 1000 : Number(balance.quantity)));
  }
  for (const [label, value] of [...stock.entries()].sort()) {
    const unit = label.startsWith("Maize") || /bulk/i.test(label) ? "t" : /thread/i.test(label) ? "cones" : /bag,/i.test(label) ? "each" : "bags";
    add("Stock now", label, round(value, unit === "t" ? 2 : 0), unit);
  }

  // Exceptions
  add("Exceptions", "Raised that day", raised, "");
  add("Exceptions", "Waiting for a decision now", openExceptions, "");
  return rows;
}
