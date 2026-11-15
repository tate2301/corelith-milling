import { Prisma, type UnitOfMeasure } from "@prisma/client";

type Amount = Prisma.Decimal | number | string;

/**
 * How many kilograms `quantity` of a product weighs, or null when it cannot
 * be known.
 *
 *   KILOGRAM  the quantity is already kilograms
 *   TONNE     the quantity is tonnes
 *   anything else (a BAG, EACH, PACKAGE …) weighs `netWeightKg` per unit
 *
 * A product with no `netWeightKg` and no weight unit has no weight: the answer
 * is null, never a guess, so a report shows a gap rather than a wrong tonnage.
 */
export function kilogramsOf(
  quantity: Amount,
  unit: UnitOfMeasure,
  netWeightKg: Amount | null | undefined,
): Prisma.Decimal | null {
  const amount = new Prisma.Decimal(quantity);
  if (unit === "KILOGRAM") return amount;
  if (unit === "TONNE") return amount.times(1000);
  if (netWeightKg === null || netWeightKg === undefined) return null;
  return amount.times(new Prisma.Decimal(netWeightKg));
}

/** The same weight in tonnes, or null when it cannot be known. */
export function tonnesOf(
  quantity: Amount,
  unit: UnitOfMeasure,
  netWeightKg: Amount | null | undefined,
): Prisma.Decimal | null {
  return kilogramsOf(quantity, unit, netWeightKg)?.dividedBy(1000) ?? null;
}
