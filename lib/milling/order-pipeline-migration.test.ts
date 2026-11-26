/**
 * Migration witness for `20261126090000_milling_order_pipeline`: old order
 * statuses become the spec's (DRAFT → PENDING, CONFIRMED and IN_DELIVERY →
 * ONGOING, DELIVERED → COMPLETE), whoever took an order is its marketing
 * agent, only the spec's statuses are stored, and vouchers keep their figures
 * sane.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

const MIGRATION = readFileSync(path.join(process.cwd(), "prisma/migrations/20261126090000_milling_order_pipeline/migration.sql"), "utf8");
const STATUS_UPDATES = MIGRATION.split("\n").filter((line) => line.startsWith("UPDATE "));

class RolledBack extends Error {}

describe("the order pipeline, as migrated", () => {
  it("maps the old statuses and names the agent", async () => {
    expect(STATUS_UPDATES.length).toBe(5);
    await expect(
      prisma.$transaction(async (tx) => {
        const run = Date.now().toString(36);
        const company = await tx.company.create({ data: { name: `Witness ${run}`, slug: `witness-${run}` } });
        const customer = await tx.customer.create({ data: { companyId: company.id, name: "Old customer" } });
        await tx.$executeRawUnsafe(`ALTER TABLE "MillingCustomerOrder" DROP CONSTRAINT "MillingCustomerOrder_status_check"`);
        for (const [code, status] of [["A", "DRAFT"], ["B", "CONFIRMED"], ["C", "IN_DELIVERY"], ["D", "DELIVERED"], ["E", "CLOSED"], ["F", "CANCELLED"]] as const) {
          await tx.millingCustomerOrder.create({ data: { companyId: company.id, code, customerId: customer.id, status, createdById: "taker", marketingAgentId: null } });
        }
        for (const statement of STATUS_UPDATES) await tx.$executeRawUnsafe(statement);
        const rows = await tx.millingCustomerOrder.findMany({ where: { companyId: company.id }, orderBy: { code: "asc" } });
        expect(rows.map((row) => row.status)).toEqual(["PENDING", "ONGOING", "ONGOING", "COMPLETE", "CLOSED", "CANCELLED"]);
        expect(rows.every((row) => row.marketingAgentId === "taker")).toBe(true);
        expect(rows.find((row) => row.code === "D")?.completedAt).not.toBeNull();
        throw new RolledBack();
      }),
    ).rejects.toBeInstanceOf(RolledBack);
  });

  it("stores only the spec's statuses, and vouchers with sane figures", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const run = Date.now().toString(36);
        const company = await tx.company.create({ data: { name: `Witness ${run}`, slug: `witness2-${run}` } });
        const customer = await tx.customer.create({ data: { companyId: company.id, name: "C" } });
        await tx.$executeRawUnsafe(`SAVEPOINT s1`);
        await expect(tx.millingCustomerOrder.create({ data: { companyId: company.id, code: "X", customerId: customer.id, status: "DRAFT", createdById: "u" } })).rejects.toThrow();
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT s1`);
        await expect(
          tx.millingVoucher.create({ data: { companyId: company.id, code: "V1", customerId: customer.id, kind: "PERCENT", value: 120, expiresOn: new Date("2026-12-31"), issuedById: "u" } }),
        ).rejects.toThrow();
        throw new RolledBack();
      }),
    ).rejects.toBeInstanceOf(RolledBack);
  });
});
