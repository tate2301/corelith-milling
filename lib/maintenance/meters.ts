import { Prisma } from "@prisma/client";

import { refreshPlansFor } from "@/lib/maintenance/plans";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

/** What a meter counts, as a person reads it. */
export const METER_UNIT: Record<"HOURS" | "KM", string> = { HOURS: "hours", KM: "km" };

export class MeterRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeterRefusal";
  }
}

export type RecordMeterReadingInput = {
  companyId: string;
  equipmentId: string;
  reading: Prisma.Decimal.Value;
  readAt?: Date;
  /** Where it was taken: "FUEL_ISSUE", "SERVICE", "TRIP", "MANUAL", or an extension's own key. */
  source?: string;
  sourceId?: string | null;
  recordedById?: string | null;
};

/**
 * Records one reading of an equipment's meter and moves `currentMeter` on.
 *
 * Meters only go up: a reading below the latest one is refused rather than
 * stored, because every figure worked out from readings (hours run, km per
 * litre, the next service) would be wrong from then on. A reading taken at an
 * earlier time than the latest one is kept, but does not move the current
 * figure. Equipment without a meter takes no readings.
 */
export async function recordMeterReading(input: RecordMeterReadingInput, db: Db = prisma) {
  const equipment = await db.equipment.findUnique({
    where: { id: input.equipmentId },
    select: { id: true, meterType: true, currentMeter: true, meterReadAt: true, site: { select: { companyId: true } } },
  });
  if (!equipment || equipment.site.companyId !== input.companyId) throw new MeterRefusal("Unknown equipment.");
  if (equipment.meterType === "NONE") throw new MeterRefusal("This equipment has no meter to read.");

  const reading = new Prisma.Decimal(input.reading).toDecimalPlaces(1);
  if (reading.isNegative()) throw new MeterRefusal("A meter reading cannot be negative.");
  const readAt = input.readAt ?? new Date();
  const latest = !equipment.meterReadAt || readAt >= equipment.meterReadAt;
  if (latest && equipment.currentMeter && reading.lessThan(equipment.currentMeter)) {
    throw new MeterRefusal(
      `The meter reads ${equipment.currentMeter} ${METER_UNIT[equipment.meterType]} already; a reading cannot go back to ${reading}.`,
    );
  }

  const row = await db.meterReading.create({
    data: {
      companyId: input.companyId,
      equipmentId: equipment.id,
      reading,
      readAt,
      source: input.source ?? "MANUAL",
      sourceId: input.sourceId ?? null,
      recordedById: input.recordedById ?? null,
    },
  });
  if (latest) {
    await db.equipment.update({ where: { id: equipment.id }, data: { currentMeter: reading, meterReadAt: readAt } });
    // The meter moved: plans counted on it come due sooner or later.
    await refreshPlansFor(db, equipment.id, readAt);
  }
  return row;
}
