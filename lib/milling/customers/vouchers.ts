import { Prisma, type PrismaClient } from "@prisma/client";

import { writePlatformAuditEvent } from "@/lib/audit/platform";

import { millRefusal } from "../errors";
import { nextDailyCode } from "../records/codes";
import { millDay } from "../sellers/trips";

/**
 * Discount vouchers (Grandmeal spec, Stage 2). A voucher belongs to one
 * customer: a percentage off, an amount off a bag, or a fixed amount, with an
 * expiry date and a use limit. A customer holds one live voucher at a time; a
 * second waits until the first is used up or has expired. A voucher comes off
 * one line, never the total afterwards, so Books can show gross sales and the
 * discounts given as separate lines.
 */

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;
const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
export const VOUCHER_ENTITY = "MillingVoucher";
export const VOUCHER_KINDS = ["PERCENT", "PER_BAG", "FIXED"] as const;
export type VoucherKind = (typeof VOUCHER_KINDS)[number];

/** Live: not void, not used up, and not past its date (the mill's day). */
export function isLive(voucher: { status: string; uses: number; useLimit: number; expiresOn: Date }, today: Date = millDay()): boolean {
  return voucher.status === "ACTIVE" && voucher.uses < voucher.useLimit && voucher.expiresOn.getTime() >= today.getTime();
}

/** What a voucher takes off a line of `bags` at `unitPrice`: never more than the line. */
export function voucherDiscount(voucher: { kind: string; value: Prisma.Decimal.Value }, line: { bags: number; unitPrice: Prisma.Decimal.Value }): Prisma.Decimal {
  const gross = D(line.unitPrice).times(line.bags);
  const raw =
    voucher.kind === "PERCENT" ? gross.times(voucher.value).dividedBy(100) : voucher.kind === "PER_BAG" ? D(voucher.value).times(line.bags) : D(voucher.value);
  return Prisma.Decimal.min(raw, gross).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export async function liveVoucherOf(db: Db | Tx, companyId: string, customerId: string, today: Date = millDay()) {
  const vouchers = await db.millingVoucher.findMany({ where: { companyId, customerId, status: "ACTIVE" }, orderBy: { issuedAt: "desc" } });
  return vouchers.find((voucher) => isLive(voucher, today)) ?? null;
}

export async function issueVoucher(
  db: Db,
  args: { companyId: string; userId: string; customerId: string; kind: VoucherKind; value: number; expiresOn: string; useLimit: number; today?: Date },
) {
  const today = args.today ?? millDay();
  if (!VOUCHER_KINDS.includes(args.kind)) throw millRefusal("Choose a percentage, an amount a bag or a fixed amount.");
  if (!(args.value > 0)) throw millRefusal("A voucher takes something off.");
  if (args.kind === "PERCENT" && args.value > 100) throw millRefusal("A percentage is at most 100.");
  if (!Number.isInteger(args.useLimit) || args.useLimit < 1) throw millRefusal("A voucher can be used at least once.");
  const expires = new Date(`${args.expiresOn}T00:00:00Z`);
  if (Number.isNaN(expires.getTime()) || expires.getTime() < today.getTime()) throw millRefusal("A voucher expires today or later.");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${args.customerId} FOR UPDATE`;
    const customer = await tx.customer.findFirst({ where: { id: args.customerId, companyId: args.companyId }, select: { id: true, name: true } });
    if (!customer) throw millRefusal("That customer is not in this workspace.");
    const live = await liveVoucherOf(tx, args.companyId, customer.id, today);
    if (live) {
      throw millRefusal(
        `${customer.name} already has ${live.code}, until ${live.expiresOn.toISOString().slice(0, 10)}. One voucher a customer: a second waits until it is used or has expired.`,
      );
    }
    const code = await nextDailyCode(tx, "millingVoucher", args.companyId, "VC");
    const voucher = await tx.millingVoucher.create({
      data: { companyId: args.companyId, code, customerId: customer.id, kind: args.kind, value: D(args.value), expiresOn: expires, useLimit: args.useLimit, issuedById: args.userId },
    });
    await writePlatformAuditEvent(
      {
        companyId: args.companyId,
        actorId: args.userId,
        eventType: "milling.voucher.issued",
        entityType: VOUCHER_ENTITY,
        entityId: voucher.id,
        payload: { code, customer: customer.name, kind: args.kind, value: args.value, expiresOn: args.expiresOn, useLimit: args.useLimit },
      },
      tx,
    );
    return voucher;
  });
}

/** Use a customer's live voucher on one line, inside the caller's transaction. Returns what it took off. */
export async function useVoucher(
  tx: Tx,
  args: {
    companyId: string;
    userId: string;
    voucherId: string;
    customerId: string;
    bags: number;
    unitPrice: Prisma.Decimal.Value;
    orderLineId?: string;
    saleLineId?: string;
    today?: Date;
  },
): Promise<Prisma.Decimal> {
  await tx.$queryRaw`SELECT "id" FROM "MillingVoucher" WHERE "id" = ${args.voucherId} FOR UPDATE`;
  const voucher = await tx.millingVoucher.findFirst({ where: { id: args.voucherId, companyId: args.companyId } });
  if (!voucher) throw millRefusal("That voucher is not in this workspace.");
  if (voucher.customerId !== args.customerId) throw millRefusal(`${voucher.code} belongs to another customer.`);
  if (!isLive(voucher, args.today ?? millDay())) throw millRefusal(`${voucher.code} is used up or has expired.`);
  const amount = voucherDiscount(voucher, { bags: args.bags, unitPrice: args.unitPrice });
  const uses = voucher.uses + 1;
  await tx.millingVoucher.update({ where: { id: voucher.id }, data: { uses, status: uses >= voucher.useLimit ? "USED" : "ACTIVE" } });
  await tx.millingVoucherUse.create({
    data: { voucherId: voucher.id, orderLineId: args.orderLineId ?? null, saleLineId: args.saleLineId ?? null, amount, usedById: args.userId },
  });
  await writePlatformAuditEvent(
    {
      companyId: args.companyId,
      actorId: args.userId,
      eventType: "milling.voucher.used",
      entityType: VOUCHER_ENTITY,
      entityId: voucher.id,
      payload: { code: voucher.code, amount: amount.toString(), orderLineId: args.orderLineId ?? null, saleLineId: args.saleLineId ?? null },
    },
    tx,
  );
  return amount;
}

export async function voidVoucher(db: Db, args: { companyId: string; userId: string; voucherId: string; reason: string }) {
  if (args.reason.trim().length < 3) throw millRefusal("Say why the voucher is void.");
  return db.$transaction(async (tx) => {
    const voucher = await tx.millingVoucher.findFirst({ where: { id: args.voucherId, companyId: args.companyId } });
    if (!voucher) throw millRefusal("That voucher is not in this workspace.");
    if (voucher.status !== "ACTIVE") throw millRefusal(`${voucher.code} is ${voucher.status.toLowerCase()}.`);
    const updated = await tx.millingVoucher.update({ where: { id: voucher.id }, data: { status: "VOID" } });
    await writePlatformAuditEvent(
      { companyId: args.companyId, actorId: args.userId, eventType: "milling.voucher.voided", entityType: VOUCHER_ENTITY, entityId: voucher.id, payload: { code: voucher.code }, reason: args.reason },
      tx,
    );
    return updated;
  });
}
