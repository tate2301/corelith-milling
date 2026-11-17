import { Prisma } from "@prisma/client";

/** A kind of day overtime is worked on, as the bands tell them apart. */
export type OvertimeDay = "WORKDAY" | "REST_DAY" | "HOLIDAY";

export type OvertimeBandRule = {
  dayKind: OvertimeDay;
  fromHours: Prisma.Decimal.Value;
  /** Open-ended when null. */
  toHours: Prisma.Decimal.Value | null;
  multiplier: Prisma.Decimal.Value;
};

export type OvertimeShift = {
  date: Date;
  status: string;
  /** Overtime hours on this shift. */
  hours: number;
};

/** ISO weekday of a date, 1 (Monday) to 7, read in UTC like `Attendance.date`. */
export function isoWeekday(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * The kind of day a shift's overtime falls on: a public holiday when the
 * shift is marked one, a rest day when it is marked one or falls on one of
 * the person's rest days, otherwise a workday.
 */
export function overtimeDay(shift: Pick<OvertimeShift, "date" | "status">, restDays: readonly number[]): OvertimeDay {
  if (shift.status === "HOLIDAY") return "HOLIDAY";
  if (shift.status === "REST_DAY" || restDays.includes(isoWeekday(shift.date))) return "REST_DAY";
  return "WORKDAY";
}

/**
 * What one person's overtime earns: each shift's hours are split across the
 * bands for its kind of day (the first two hours at 1.5, the rest at 2), and
 * each slice is paid at the person's overtime rate times the band's
 * multiplier. Hours a kind of day has no band for are paid at the rate. With
 * no bands at all, every hour is paid at the rate, as before bands existed.
 */
export function bandedOvertimePay(
  shifts: readonly OvertimeShift[],
  bands: readonly OvertimeBandRule[],
  rate: Prisma.Decimal.Value,
  restDays: readonly number[],
): Prisma.Decimal {
  const hourly = new Prisma.Decimal(rate);
  let total = new Prisma.Decimal(0);
  for (const shift of shifts) {
    if (!(shift.hours > 0)) continue;
    const hours = new Prisma.Decimal(shift.hours);
    const kind = overtimeDay(shift, restDays);
    const own = bands
      .filter((band) => band.dayKind === kind)
      .map((band) => ({
        from: new Prisma.Decimal(band.fromHours),
        to: band.toHours === null ? null : new Prisma.Decimal(band.toHours),
        multiplier: new Prisma.Decimal(band.multiplier),
      }))
      .sort((a, b) => a.from.comparedTo(b.from));
    let banded = new Prisma.Decimal(0);
    for (const band of own) {
      const top = band.to === null ? hours : Prisma.Decimal.min(band.to, hours);
      const slice = top.minus(band.from);
      if (slice.lessThanOrEqualTo(0)) continue;
      total = total.plus(slice.times(hourly).times(band.multiplier));
      banded = banded.plus(slice);
    }
    const left = hours.minus(banded);
    if (left.greaterThan(0)) total = total.plus(left.times(hourly));
  }
  return total.toDecimalPlaces(2);
}
