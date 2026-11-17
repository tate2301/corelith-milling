import type { PrismaClient } from "@prisma/client";

import { millRefusal } from "../errors";

/**
 * Traceability (plan 4.12): supplier delivery → intake lot → batch → bulk lot
 * → packed lot → customer delivery, both ways, many to many. Built from what
 * the mill already records (lot origins, batch sources, pack runs, delivery
 * lines, gate-sale matches), so nobody enters anything extra for it.
 */

export interface TraceNode {
  kind: "intake" | "lot" | "batch" | "pack" | "delivery" | "gate";
  id: string;
  code: string;
  label: string;
  /** Where the record opens. */
  href: string | null;
  quantity?: string;
  children: TraceNode[];
}

type Db = PrismaClient;
const MAX_DEPTH = 8;

async function lotNode(db: Db, companyId: string, lotId: string): Promise<{ id: string; code: string; label: string; productId: string; originType: string; originId: string | null } | null> {
  const lot = await db.millingLot.findFirst({ where: { id: lotId, companyId } });
  if (!lot) return null;
  const product = await db.product.findUnique({ where: { id: lot.productId }, select: { name: true } });
  return { id: lot.id, code: lot.code, label: `${product?.name ?? "Lot"} · ${lot.status.toLowerCase()}`, productId: lot.productId, originType: lot.originType, originId: lot.originId };
}

/** Where a lot came from, back to the supplier. */
export async function traceBack(db: Db, companyId: string, lotId: string, depth = 0): Promise<TraceNode | null> {
  const lot = await lotNode(db, companyId, lotId);
  if (!lot) return null;
  const node: TraceNode = { kind: "lot", id: lot.id, code: lot.code, label: lot.label, href: `/milling/stock?lot=${lot.id}`, children: [] };
  if (depth >= MAX_DEPTH || !lot.originId) return node;
  if (lot.originType === "INTAKE") {
    const intake = await db.millingIntake.findFirst({ where: { id: lot.originId, companyId } });
    if (intake) node.children.push({ kind: "intake", id: intake.id, code: intake.code, label: `${intake.supplierName}${intake.vehicleReg ? ` · ${intake.vehicleReg}` : ""}`, href: `/milling/intake/${intake.id}`, quantity: `${Number(intake.netKg)} kg`, children: [] });
  } else if (lot.originType === "BATCH") {
    const batch = await db.millingBatch.findFirst({ where: { id: lot.originId, companyId }, include: { sources: true } });
    if (batch) {
      const batchNode: TraceNode = { kind: "batch", id: batch.id, code: batch.code, label: "Batch", href: `/milling/production/${batch.id}`, children: [] };
      for (const source of batch.sources) {
        const back = await traceBack(db, companyId, source.lotId, depth + 1);
        if (back) batchNode.children.push({ ...back, quantity: `${Number(source.quantityKg)} kg` });
      }
      node.children.push(batchNode);
    }
  } else if (lot.originType === "PACK") {
    const run = await db.millingPackRun.findFirst({ where: { id: lot.originId, companyId } });
    if (run) {
      const runNode: TraceNode = { kind: "pack", id: run.id, code: run.code, label: "Pack run", href: "/milling/packing", children: [] };
      const back = await traceBack(db, companyId, run.bulkLotId, depth + 1);
      if (back) runNode.children.push({ ...back, quantity: `${Number(run.bulkUsedKg)} kg` });
      node.children.push(runNode);
    }
  } else if (lot.originType === "RETURN") {
    const delivery = await db.millingDelivery.findFirst({ where: { id: lot.originId, companyId } });
    if (delivery) node.children.push({ kind: "delivery", id: delivery.id, code: delivery.code, label: "Returned from delivery", href: `/milling/deliveries/${delivery.id}`, children: [] });
  }
  return node;
}

/** Where a lot went, out to customers. */
export async function traceForward(db: Db, companyId: string, lotId: string, depth = 0): Promise<TraceNode | null> {
  const lot = await lotNode(db, companyId, lotId);
  if (!lot) return null;
  const node: TraceNode = { kind: "lot", id: lot.id, code: lot.code, label: lot.label, href: `/milling/stock?lot=${lot.id}`, children: [] };
  if (depth >= MAX_DEPTH) return node;

  const [sources, runs, lines, gate] = await Promise.all([
    db.millingBatchSourceLot.findMany({ where: { lotId: lot.id, batch: { companyId } }, include: { batch: { include: { outputs: true } } } }),
    db.millingPackRun.findMany({ where: { companyId, bulkLotId: lot.id } }),
    db.millingDeliveryLine.findMany({ where: { lotId: lot.id, delivery: { companyId } }, include: { delivery: true } }),
    db.millingLotMovement.aggregate({ where: { companyId, lotId: lot.id, reason: "GATE_SALE" }, _sum: { quantity: true } }),
  ]);
  for (const source of sources) {
    const batchNode: TraceNode = { kind: "batch", id: source.batch.id, code: source.batch.code, label: "Batch", href: `/milling/production/${source.batch.id}`, quantity: `${Number(source.quantityKg)} kg in`, children: [] };
    for (const lotId of [...new Set(source.batch.outputs.map((output) => output.lotId))]) {
      const forward = await traceForward(db, companyId, lotId, depth + 1);
      if (forward) batchNode.children.push(forward);
    }
    node.children.push(batchNode);
  }
  for (const run of runs) {
    const runNode: TraceNode = { kind: "pack", id: run.id, code: run.code, label: "Pack run", href: "/milling/packing", quantity: `${Number(run.bulkUsedKg)} kg in`, children: [] };
    const forward = await traceForward(db, companyId, run.outputLotId, depth + 1);
    if (forward) runNode.children.push(forward);
    node.children.push(runNode);
  }
  if (lines.length) {
    const orders = await db.millingCustomerOrder.findMany({ where: { id: { in: lines.map((line) => line.orderId) } }, select: { id: true, customerId: true } });
    const customers = await db.customer.findMany({ where: { companyId, id: { in: orders.map((order) => order.customerId) } }, select: { id: true, name: true } });
    for (const line of lines) {
      const customer = customers.find((entry) => entry.id === orders.find((order) => order.id === line.orderId)?.customerId);
      node.children.push({ kind: "delivery", id: line.delivery.id, code: line.delivery.code, label: customer?.name ?? "Customer", href: `/milling/deliveries/${line.delivery.id}`, quantity: `${line.deliveredBags ?? line.bags} bags`, children: [] });
    }
  }
  if (gate._sum.quantity && Number(gate._sum.quantity) > 0) {
    node.children.push({ kind: "gate", id: `${lot.id}-gate`, code: "Gate", label: "Sold at the gate till", href: null, quantity: `${Number(gate._sum.quantity)} bags`, children: [] });
  }
  return node;
}

/**
 * Trace from any code: a lot, a delivery note (MI-), a batch (B-), a pack run
 * (PK-) or a customer delivery (DN-). Returns the lots it concerns, each traced
 * back to suppliers and forward to customers.
 */
export async function trace(db: Db, companyId: string, code: string) {
  const wanted = code.trim().toUpperCase();
  if (!wanted) throw millRefusal("Enter a lot, delivery, batch or trip code.");
  const lotIds: string[] = [];
  const lot = await db.millingLot.findFirst({ where: { companyId, code: wanted } });
  if (lot) lotIds.push(lot.id);
  const intake = lot ? null : await db.millingIntake.findFirst({ where: { companyId, code: wanted } });
  if (intake?.lotId) lotIds.push(intake.lotId);
  const batch = lot || intake ? null : await db.millingBatch.findFirst({ where: { companyId, code: wanted }, include: { outputs: true, sources: true } });
  if (batch) lotIds.push(...new Set([...batch.sources.map((row) => row.lotId), ...batch.outputs.map((row) => row.lotId)]));
  const run = lotIds.length ? null : await db.millingPackRun.findFirst({ where: { companyId, code: wanted } });
  if (run) lotIds.push(run.outputLotId);
  const delivery = lotIds.length ? null : await db.millingDelivery.findFirst({ where: { companyId, code: wanted }, include: { lines: true } });
  if (delivery) lotIds.push(...new Set(delivery.lines.map((line) => line.lotId)));
  if (!lotIds.length) throw millRefusal(`Nothing at the mill has the code ${wanted}.`);
  const unique = [...new Set(lotIds)];
  return Promise.all(
    unique.map(async (id) => ({
      lotId: id,
      back: await traceBack(db, companyId, id),
      forward: await traceForward(db, companyId, id),
    })),
  );
}
