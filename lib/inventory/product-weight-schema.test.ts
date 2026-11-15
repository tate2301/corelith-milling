/**
 * Migration witness for 20261114090000_product_tonne_bag_net_weight.
 *
 * `lib/inventory/weight.ts` and the catalogue would pass their own tests
 * against a schema file that disagreed with the database. This reads the
 * catalogue and pins what the migration exists to do:
 *
 *  - Products can be sold by the TONNE and by the BAG.
 *  - `Product.netWeightKg` is an exact number and NULLABLE: no product has a
 *    weight until someone gives it one.
 *  - Vane's and Explore's readers can read it. Their grants are per column, so
 *    a column added without a grant stays invisible to them.
 */
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

describe("products carry a unit weight", () => {
  it("adds TONNE and BAG to UnitOfMeasure", async () => {
    const rows = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'UnitOfMeasure'
    `;
    const labels = rows.map((row) => row.enumlabel);
    expect(labels).toEqual(expect.arrayContaining(["KILOGRAM", "TONNE", "BAG", "OTHER"]));
  });

  it("adds a nullable numeric netWeightKg to Product", async () => {
    const rows = await prisma.$queryRaw<Array<{ is_nullable: string; data_type: string; numeric_scale: number | null }>>`
      SELECT is_nullable, data_type, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Product' AND column_name = 'netWeightKg'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ is_nullable: "YES", data_type: "numeric", numeric_scale: 4 });
  });

  it("grants the column to Vane's and Explore's readers", async () => {
    const rows = await prisma.$queryRaw<Array<{ grantee: string }>>`
      SELECT grantee FROM information_schema.column_privileges
      WHERE table_schema = 'public' AND table_name = 'Product' AND column_name = 'netWeightKg'
        AND privilege_type = 'SELECT' AND grantee IN ('vane_reader', 'explore_reader')
    `;
    expect(rows.map((row) => row.grantee).sort()).toEqual(["explore_reader", "vane_reader"]);
  });
});
