import type { PrismaClient } from "@prisma/client";

import { getGeneralSettings } from "../settings/server";
import { millDay, sellerBalance } from "./trips";

/**
 * What the Sellers screen reads: each seller with what they owe and their
 * trip today, the day's trips, the stores bags can come from, and the
 * products with their price.
 */
export async function sellersBoard(db: PrismaClient, companyId: string, date?: string | null, books: { mayPost: boolean } = { mayPost: false }) {
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : millDay();
  const sellers = await db.millingSeller.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } });
  const [employees, trips, openTrips, stores, products, settings, rates, accounts, unposted] = await Promise.all([
    db.employee.findMany({ where: { companyId, id: { in: sellers.map((row) => row.employeeId) } }, select: { id: true, name: true, employeeId: true, userId: true } }),
    // The day's trips, and any still out from an earlier day: they have to be settled too.
    db.millingSellerTrip.findMany({ where: { companyId, OR: [{ tripDate: day }, { status: "OUT" }] }, include: { lines: true, discounts: true }, orderBy: { code: "asc" } }),
    db.millingSellerTrip.findMany({ where: { companyId, status: "OUT" }, select: { id: true, code: true, sellerId: true, tripDate: true } }),
    db.stockLocation.findMany({
      where: { site: { companyId }, isActive: true, code: { not: "WITH-SELLERS" } },
      select: { id: true, code: true, name: true, siteId: true, site: { select: { name: true } } },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    }),
    db.product.findMany({ where: { companyId, unit: "BAG" }, select: { id: true, code: true, name: true, standardPrice: true }, orderBy: { name: "asc" } }),
    getGeneralSettings(db, companyId),
    db.millingSellerRate.findMany({ where: { companyId } }),
    books.mayPost ? db.bankAccount.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true, kind: true, currency: true }, orderBy: { name: "asc" } }) : [],
    // Money handed in that is not in Books yet.
    db.millingSellerPayment.findMany({ where: { companyId, postedAt: null }, orderBy: { receivedAt: "asc" }, take: 200 }),
  ]);
  // Where released bags are free to take, product by product.
  const freeBalances = await db.millingLotBalance.findMany({
    where: { companyId, stockLocationId: { in: stores.map((row) => row.id) }, quantity: { gt: 0 }, lot: { status: "AVAILABLE", productId: { in: products.map((row) => row.id) } } },
    select: { stockLocationId: true, quantity: true, reserved: true, lot: { select: { productId: true } } },
  });
  const freeAt = new Map<string, Record<string, number>>();
  for (const row of freeBalances) {
    const free = Number(row.quantity) - Number(row.reserved);
    if (free <= 0) continue;
    const entry = freeAt.get(row.stockLocationId) ?? {};
    entry[row.lot.productId] = (entry[row.lot.productId] ?? 0) + free;
    freeAt.set(row.stockLocationId, entry);
  }
  const owedBySeller = await Promise.all(sellers.map((seller) => sellerBalance(db, companyId, seller.id)));
  const nameOf = (sellerId: string) => employees.find((row) => row.id === sellers.find((seller) => seller.id === sellerId)?.employeeId)?.name ?? "";
  const productName = (id: string) => products.find((row) => row.id === id)?.name ?? "";

  return {
    day: day.toISOString().slice(0, 10),
    books: {
      mayPost: books.mayPost,
      // Cash accounts first: sellers hand in cash.
      accounts: [...accounts].sort((a, b) => Number(b.kind === "CASH") - Number(a.kind === "CASH")).map((row) => ({ id: row.id, name: row.name, currency: row.currency })),
      repayments: unposted
        .filter((row) => row.kind === "REPAYMENT")
        .map((row) => ({ id: row.id, sellerId: row.sellerId, seller: nameOf(row.sellerId), amount: Number(row.amount), receivedAt: row.receivedAt })),
    },
    rules: { maxDiscount: settings.sellerMaxDiscount, step: settings.sellerDiscountStep },
    sellers: sellers.map((seller, index) => {
      const employee = employees.find((row) => row.id === seller.employeeId);
      const open = openTrips.find((trip) => trip.sellerId === seller.id);
      return {
        id: seller.id,
        employeeId: seller.employeeId,
        userId: employee?.userId ?? null,
        name: employee?.name ?? "",
        number: employee?.employeeId ?? "",
        isActive: seller.isActive,
        owed: Number(owedBySeller[index]),
        outOn: open ? { id: open.id, code: open.code, date: open.tripDate.toISOString().slice(0, 10) } : null,
      };
    }),
    trips: trips.map((trip) => {
      const byProduct = new Map<string, { productId: string; product: string; out: number; back: number | null; sold: number | null; unitPrice: number }>();
      for (const line of trip.lines) {
        const row = byProduct.get(line.productId) ?? { productId: line.productId, product: productName(line.productId), out: 0, back: null, sold: null, unitPrice: Number(line.unitPrice) };
        row.out += line.bagsOut;
        if (line.bagsBack !== null) row.back = (row.back ?? 0) + line.bagsBack;
        if (line.bagsSold !== null) row.sold = (row.sold ?? 0) + line.bagsSold;
        byProduct.set(line.productId, row);
      }
      return {
        id: trip.id,
        code: trip.code,
        status: trip.status,
        sellerId: trip.sellerId,
        seller: nameOf(trip.sellerId),
        from: stores.find((row) => row.id === trip.fromLocationId)?.name ?? "",
        issuedAt: trip.issuedAt,
        settledAt: trip.settledAt,
        overrideReason: trip.overrideReason,
        bagsOut: trip.lines.reduce((sum, line) => sum + line.bagsOut, 0),
        products: [...byProduct.values()],
        discounts: trip.discounts.map((row) => ({ productId: row.productId, product: productName(row.productId), discount: Number(row.discount), bags: row.bags })),
        grossAmount: trip.grossAmount === null ? null : Number(trip.grossAmount),
        discountAmount: trip.discountAmount === null ? null : Number(trip.discountAmount),
        amountDue: trip.amountDue === null ? null : Number(trip.amountDue),
        cashReceived: trip.cashReceived === null ? null : Number(trip.cashReceived),
        shortage: trip.shortage === null ? null : Number(trip.shortage),
        commissionAmount: trip.commissionAmount === null ? null : Number(trip.commissionAmount),
        invoiceId: trip.invoiceId,
        // In Books once the invoice is issued (when anything was sold) and the cash handed in is posted.
        inBooks:
          trip.status === "SETTLED" &&
          (trip.invoiceId !== null || Number(trip.amountDue ?? 0) === 0) &&
          !unposted.some((row) => row.tripId === trip.id),
      };
    }),
    // Only places holding released bags, the fullest first: that is where a seller collects.
    stores: stores
      .filter((row) => freeAt.has(row.id))
      .map((row) => ({ id: row.id, code: row.code, name: row.name, site: row.site.name, free: freeAt.get(row.id) ?? {} }))
      .sort((a, b) => Object.values(b.free).reduce((x, y) => x + y, 0) - Object.values(a.free).reduce((x, y) => x + y, 0)),
    products: products.map((row) => {
      const rate = rates.find((entry) => entry.productId === row.id);
      return { id: row.id, code: row.code, name: row.name, price: Number(row.standardPrice), commissionPerBag: Number(rate?.commissionPerBag ?? 0), commissionPct: Number(rate?.commissionPct ?? 0) };
    }),
  };
}
