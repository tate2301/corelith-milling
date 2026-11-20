import { Prisma, type PrismaClient } from "@prisma/client";

import { createJournalEntryFromSource, previewPostingFromSource, type PostingContext } from "@/lib/accounting/posting";
import { writePlatformAuditEvent } from "@/lib/audit/platform";

import { millRefusal } from "../errors";
import { nextDailyCode } from "../records/codes";
import { millDay } from "../sellers/trips";
import { recordOpeningStock } from "../stock/counts";

/**
 * Go-live (canvas GL-A1, GL-B1, GL-B2).
 *
 * The seven steps the mill takes before its first day, each with its state
 * read from what is actually there, never from a link being visited:
 * sites, users in groups, products with weights and prices, the gate till and
 * its fiscal device, opening stock, opening debtors, and pack recipes and
 * specs.
 *
 * Opening stock is a document: counted line by line at cost, previewed as the
 * journal it will post, then posted once. Posting puts each line into a lot at
 * its place, and into Books (Dr Stock / Cr Opening balances, core's opening
 * stock rule). A wrong count after that is corrected with a stock count or
 * adjustment, never by undoing the opening.
 */

type Db = PrismaClient;
const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
export const USER_LIMIT = 50;

export type StepState = "DONE" | "STARTED" | "WAITING" | "NOT_STARTED";
export interface GoLiveStep {
  key: string;
  step: string;
  layer: string;
  owner: string;
  state: StepState;
  detail: string;
  href: string;
}

export async function goLiveSteps(db: Db, companyId: string): Promise<GoLiveStep[]> {
  const [sites, places, users, members, bagged, fiscal, tills, opening, openingBalances, recipes, specs] = await Promise.all([
    db.site.count({ where: { companyId, isActive: true } }),
    db.stockLocation.count({ where: { site: { companyId }, isActive: true, code: { not: "WITH-SELLERS" } } }),
    db.user.count({ where: { companyId, isActive: true } }),
    db.millingGroupMember.findMany({ where: { companyId }, select: { userId: true }, distinct: ["userId"] }),
    db.product.findMany({ where: { companyId, unit: "BAG" }, select: { netWeightKg: true, standardPrice: true } }),
    db.fiscalisationProviderConfig.findFirst({ where: { companyId, isActive: true }, select: { deviceId: true, certificateRef: true } }),
    db.retailDevice.count({ where: { companyId, unpairedAt: null } }),
    db.millingOpeningStock.findFirst({ where: { companyId }, orderBy: { createdAt: "desc" }, include: { lines: { select: { id: true } } } }),
    db.openingBalanceImport.count({ where: { companyId } }),
    db.millingPackRecipe.count({ where: { companyId } }),
    db.millingQcSpec.count({ where: { companyId, isActive: true } }),
  ]);
  const ready = bagged.filter((row) => row.netWeightKg !== null && Number(row.netWeightKg) > 0 && Number(row.standardPrice) > 0).length;
  const fiscalReady = Boolean(fiscal?.deviceId && fiscal.certificateRef);
  return [
    {
      key: "sites",
      step: "Sites and sections",
      layer: "L0",
      owner: "Mill Manager",
      state: sites && places ? "DONE" : sites ? "STARTED" : "NOT_STARTED",
      detail: `${sites} ${sites === 1 ? "site" : "sites"}, ${places} ${places === 1 ? "place" : "places"} for stock`,
      href: "/preferences/organization/sites",
    },
    {
      key: "users",
      step: "Users and roles",
      layer: "L0",
      owner: "Mill Manager",
      state: members.length === 0 ? "NOT_STARTED" : members.length >= users ? "DONE" : "STARTED",
      detail: `${users} of up to ${USER_LIMIT} added, ${members.length} in the mill's groups`,
      href: "/milling/settings/groups",
    },
    {
      key: "products",
      step: "Products and units",
      layer: "L1",
      owner: "Stores Controller",
      state: !bagged.length ? "NOT_STARTED" : ready === bagged.length ? "DONE" : "STARTED",
      detail: bagged.length ? `${ready} of ${bagged.length} bagged products have a weight and a price` : "No bagged products yet",
      href: "/retail/products",
    },
    {
      key: "till",
      step: "Gate till and ZIMRA",
      layer: "L1",
      owner: "Despatch Clerk",
      state: fiscalReady && tills ? "DONE" : fiscal && !fiscalReady ? "WAITING" : tills || fiscal ? "STARTED" : "NOT_STARTED",
      detail: fiscalReady ? (tills ? `${tills} ${tills === 1 ? "till" : "tills"} paired, fiscal device registered` : "Fiscal device registered; pair a till") : fiscal ? "Fiscal device credentials" : tills ? `${tills} paired, no fiscal device yet` : "No till paired",
      href: "/milling/settings/shop",
    },
    {
      key: "opening",
      step: "Opening stock",
      layer: "L1",
      owner: "Stores Controller",
      state: opening?.status === "POSTED" ? "DONE" : opening ? "STARTED" : "NOT_STARTED",
      detail: opening?.status === "POSTED" ? `${opening.code} posted` : opening ? `${opening.lines.length} ${opening.lines.length === 1 ? "count" : "counts"} typed, not posted` : "Count what is in each store",
      href: "/milling/go-live/opening-stock",
    },
    {
      key: "debtors",
      step: "Opening debtors",
      layer: "L1",
      owner: "Accountant",
      state: openingBalances ? "DONE" : "NOT_STARTED",
      detail: openingBalances ? "Opening balances imported in Books" : "Typed from the debtors list",
      href: "/books/settings/opening-balances",
    },
    {
      key: "recipes",
      step: "Pack recipes and specs",
      layer: "L2",
      owner: "Mill Manager",
      state: recipes && specs ? "DONE" : recipes || specs ? "STARTED" : "NOT_STARTED",
      detail: `${recipes} ${recipes === 1 ? "recipe" : "recipes"}, ${specs} ${specs === 1 ? "spec" : "specs"}; before the first packing run`,
      href: "/milling/settings/recipes",
    },
  ];
}

async function openingOrThrow(db: Db | Prisma.TransactionClient, companyId: string, openingId: string) {
  const opening = await db.millingOpeningStock.findFirst({ where: { id: openingId, companyId }, include: { lines: true } });
  if (!opening) throw millRefusal("That opening stock is not in this workspace.");
  return opening;
}

/** The draft opening stock, made the first time it is needed; or the posted one. */
export async function currentOpening(db: Db, args: { companyId: string; userId: string; create?: boolean }) {
  const existing = await db.millingOpeningStock.findFirst({ where: { companyId: args.companyId }, orderBy: { createdAt: "desc" } });
  if (existing || !args.create) return existing;
  return db.$transaction(async (tx) => {
    const code = await nextDailyCode(tx, "millingOpeningStock", args.companyId, "OS");
    return tx.millingOpeningStock.create({ data: { companyId: args.companyId, code, asOf: millDay(), createdById: args.userId } });
  });
}

/** Type or change a count: an item at a place, its quantity and cost. Only while a draft. */
export async function setOpeningLine(db: Db, args: { companyId: string; userId: string; openingId: string; productId: string; stockLocationId: string; quantity: number; unitCost: number }) {
  const opening = await openingOrThrow(db, args.companyId, args.openingId);
  if (opening.status !== "DRAFT") throw millRefusal(`${opening.code} is posted. Correct a count with a stock count.`);
  if (!Number.isFinite(args.quantity) || args.quantity <= 0) throw millRefusal("A count is more than nothing.");
  if (!Number.isFinite(args.unitCost) || args.unitCost < 0) throw millRefusal("A cost is nothing or more.");
  const [product, place] = await Promise.all([
    db.product.findFirst({ where: { id: args.productId, companyId: args.companyId }, select: { id: true } }),
    db.stockLocation.findFirst({ where: { id: args.stockLocationId, site: { companyId: args.companyId } }, select: { id: true } }),
  ]);
  if (!product) throw millRefusal("That product is not in this workspace.");
  if (!place) throw millRefusal("That place is not the mill's.");
  const line = await db.millingOpeningStockLine.upsert({
    where: { openingId_productId_stockLocationId: { openingId: opening.id, productId: product.id, stockLocationId: place.id } },
    update: { quantity: args.quantity, unitCost: args.unitCost, updatedById: args.userId },
    create: { openingId: opening.id, productId: product.id, stockLocationId: place.id, quantity: args.quantity, unitCost: args.unitCost, updatedById: args.userId },
  });
  await writePlatformAuditEvent({ companyId: args.companyId, actorId: args.userId, eventType: "milling.opening-stock.counted", entityType: "MillingOpeningStock", entityId: opening.id, payload: { productId: product.id, stockLocationId: place.id, quantity: args.quantity, unitCost: args.unitCost } });
  return line;
}

export async function removeOpeningLine(db: Db, args: { companyId: string; openingId: string; lineId: string }) {
  const opening = await openingOrThrow(db, args.companyId, args.openingId);
  if (opening.status !== "DRAFT") throw millRefusal(`${opening.code} is posted.`);
  await db.millingOpeningStockLine.deleteMany({ where: { id: args.lineId, openingId: opening.id } });
}

const lineValue = (line: { quantity: Prisma.Decimal.Value; unitCost: Prisma.Decimal.Value }) => D(line.quantity).times(line.unitCost).toDecimalPlaces(2);

function postingFor(companyId: string, userId: string, opening: { code: string; asOf: Date }, line: { id: string }, amount: Prisma.Decimal, description: string): PostingContext {
  return {
    companyId,
    sourceType: "RETAIL_OPENING_STOCK",
    sourceId: line.id,
    entryDate: opening.asOf,
    description: `Opening stock ${opening.code}: ${description}`,
    createdById: userId,
    amount: amount.toNumber(),
    netAmount: amount.toNumber(),
    grossAmount: amount.toNumber(),
    taxAmount: 0,
  };
}

/** The opening stock with each line named and valued, and the journal it will post (GL-B1's right-hand panel). */
export async function openingView(db: Db, args: { companyId: string; userId: string; openingId: string }) {
  const opening = await openingOrThrow(db, args.companyId, args.openingId);
  const [products, places] = await Promise.all([
    db.product.findMany({ where: { id: { in: opening.lines.map((line) => line.productId) } }, select: { id: true, name: true, unit: true } }),
    db.stockLocation.findMany({ where: { id: { in: opening.lines.map((line) => line.stockLocationId) } }, select: { id: true, name: true } }),
  ]);
  const lines = opening.lines.map((line) => ({
    id: line.id,
    productId: line.productId,
    product: products.find((row) => row.id === line.productId)?.name ?? "",
    unit: products.find((row) => row.id === line.productId)?.unit ?? null,
    stockLocationId: line.stockLocationId,
    place: places.find((row) => row.id === line.stockLocationId)?.name ?? "",
    quantity: Number(line.quantity),
    unitCost: Number(line.unitCost),
    value: lineValue(line).toNumber(),
    posted: Boolean(line.lotId),
  }));
  const total = lines.reduce((sum, line) => sum.plus(line.value), D(0)).toDecimalPlaces(2);

  // The journal, as Books would post it: each line's own entry, summed by account.
  const accounts = new Map<string, { code: string; name: string; debit: number; credit: number }>();
  const warnings = new Set<string>();
  for (const line of lines) {
    if (line.value <= 0) continue;
    const preview = await previewPostingFromSource(postingFor(args.companyId, args.userId, opening, line, D(line.value), line.product));
    if (preview.error) warnings.add(preview.error);
    for (const row of preview.lines) {
      const entry = accounts.get(row.accountCode) ?? { code: row.accountCode, name: row.accountName, debit: 0, credit: 0 };
      entry.debit = Math.round((entry.debit + row.debit) * 100) / 100;
      entry.credit = Math.round((entry.credit + row.credit) * 100) / 100;
      accounts.set(row.accountCode, entry);
    }
  }
  const journal = [...accounts.values()].sort((a, b) => b.debit - a.debit || a.code.localeCompare(b.code));
  return {
    id: opening.id,
    code: opening.code,
    status: opening.status,
    asOf: opening.asOf,
    postedAt: opening.postedAt,
    lines,
    total: total.toNumber(),
    journal,
    journalBalanced: journal.reduce((sum, row) => sum + row.debit - row.credit, 0) === 0,
    warnings: [...warnings],
  };
}

/**
 * Post the opening stock: each line into a lot at its place, then into Books.
 * Safe to repeat: a line already in a lot is not received again, and a line's
 * journal is posted once (its source is the line).
 */
export async function postOpening(db: Db, args: { companyId: string; userId: string; openingId: string }) {
  const opening = await openingOrThrow(db, args.companyId, args.openingId);
  if (!opening.lines.length) throw millRefusal("Count at least one item before posting.");
  if (opening.status === "POSTED" && opening.lines.every((line) => line.journalEntryId || lineValue(line).lte(0))) throw millRefusal(`${opening.code} is already posted.`);
  const products = await db.product.findMany({ where: { id: { in: opening.lines.map((line) => line.productId) } }, select: { id: true, name: true } });
  const failures: string[] = [];
  const ordered = [...opening.lines].sort((a, b) => a.id.localeCompare(b.id));
  for (const [index, line] of ordered.entries()) {
    if (!line.lotId) {
      // Each line's lot has a code of its own, so a post interrupted after the stock went in finds it, and never receives twice.
      const lotCode = `${opening.code}-${String(index + 1).padStart(2, "0")}`;
      const existing = await db.millingLot.findFirst({ where: { companyId: args.companyId, code: lotCode }, select: { id: true } });
      const lot =
        existing ??
        (await recordOpeningStock(db, { companyId: args.companyId, userId: args.userId, productId: line.productId, stockLocationId: line.stockLocationId, quantity: line.quantity.toString(), unitCost: line.unitCost.toString(), lotCode }));
      await db.millingOpeningStockLine.update({ where: { id: line.id }, data: { lotId: lot.id } });
    }
    const value = lineValue(line);
    if (line.journalEntryId || value.lte(0)) continue;
    const name = products.find((row) => row.id === line.productId)?.name ?? "item";
    // Posted now, not with a shop's end-of-day run: opening stock is a one-off that belongs on the books at once.
    const result = await createJournalEntryFromSource(postingFor(args.companyId, args.userId, opening, line, value, name), undefined, { postNow: true });
    if (result.entryId) await db.millingOpeningStockLine.update({ where: { id: line.id }, data: { journalEntryId: result.entryId } });
    else failures.push(`${name}: ${result.error ?? "not posted"}`);
  }
  const posted = await db.millingOpeningStock.update({ where: { id: opening.id }, data: { status: "POSTED", postedAt: opening.postedAt ?? new Date(), postedById: opening.postedById ?? args.userId } });
  await writePlatformAuditEvent({ companyId: args.companyId, actorId: args.userId, eventType: "milling.opening-stock.posted", entityType: "MillingOpeningStock", entityId: opening.id, payload: { lines: opening.lines.length, failures } });
  // The stock is in; what Books could not post is said, and posting again retries only that.
  return { opening: posted, failures };
}
