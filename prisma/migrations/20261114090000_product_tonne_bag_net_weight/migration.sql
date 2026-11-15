-- Products sold by the bag or by the tonne, and how much one unit weighs.
--
-- A mill counts finished goods in bags and reports them in tonnes; maize is
-- bought by the tonne. `netWeightKg` is the net weight of one unit of the
-- product (a 10 kg bag holds 10), so tonnage = quantity x netWeightKg / 1000.
-- Nullable with no default: no existing product has a weight until someone
-- gives it one, and nothing guesses.
--
-- The new enum values are not used inside this migration, so adding them in
-- Prisma's transaction is safe.

ALTER TYPE "UnitOfMeasure" ADD VALUE 'TONNE';
ALTER TYPE "UnitOfMeasure" ADD VALUE 'BAG';

ALTER TABLE "Product" ADD COLUMN "netWeightKg" DECIMAL(12,4);

-- Vane's reader reaches the new column, as `pnpm vane:reader-sql` prints it.
GRANT SELECT ("netWeightKg") ON "Product" TO vane_reader;

-- Explore's reader too, as `pnpm explore:reader-sql` prints it.
GRANT SELECT ("netWeightKg") ON "Product" TO explore_reader;
