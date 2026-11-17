/**
 * How old a school's arrears are.
 *
 * Every surface that draws arrears — the finance overview, the arrears report
 * and the dashboard — reads its buckets from here. The boundaries and the
 * labels are one definition in one place because they are not three opinions:
 * the same $3,920 filed under "1–30 days" on one screen and "Current" on
 * another is a figure a bursar cannot chase, since neither screen can be
 * believed over the other.
 *
 * The bands are the accounting AR report's own (`app/accounting/receivables`),
 * so a bursar reading the school's books beside the company's reads one
 * layout: Current, 1–30, 31–60, 61–90, 90+.
 *
 * **A balance that falls due today is Current.** Ageing counts whole days from
 * each bill's own due date, so a bill leaves Current at midnight after the day
 * it is due, never on the day itself. School fees fall due on one announced
 * day a term and the whole school pays against that day; counting the due date
 * as a day overdue would put every family into arrears on the morning the
 * fees were due, which is the one morning nobody should be rung about them.
 *
 * Ninety days is the last boundary because a term runs about thirteen weeks.
 * Money still owed past ninety days has outlived the term it paid for, and
 * that is where a late payment stops being late and becomes a debt to chase.
 */

import { AGE_BAND_LABELS, ageBand, daysPastDue } from "@/lib/ageing";

export type AgeingBucketKey = "current" | "days30" | "days60" | "days90" | "days90Plus";

/** The `Breakdown` tones, so a band can be drawn without a second lookup table. */
export type AgeingTone = "good" | "neutral" | "warn" | "danger";

export type AgeingBucket = {
  key: AgeingBucketKey;
  label: string;
  /** Whole days past due, inclusive. `null` on the open end of a band. */
  from: number | null;
  to: number | null;
  tone: AgeingTone;
};

/** The school's keys for the one ageing (`lib/ageing.ts`), with its words. */
export const AGEING_BUCKETS: readonly AgeingBucket[] = [
  { key: "current", label: AGE_BAND_LABELS.current, from: null, to: 0, tone: "good" },
  { key: "days30", label: AGE_BAND_LABELS.days30, from: 1, to: 30, tone: "neutral" },
  { key: "days60", label: AGE_BAND_LABELS.days60, from: 31, to: 60, tone: "warn" },
  { key: "days90", label: AGE_BAND_LABELS.days90, from: 61, to: 90, tone: "warn" },
  { key: "days90Plus", label: AGE_BAND_LABELS.over90, from: 91, to: null, tone: "danger" },
];

export { daysPastDue };

/** Which band a balance sits in, given whole days past its due date. */
export function ageingBucket(daysOverdue: number): AgeingBucketKey {
  const band = ageBand(daysOverdue);
  return band === "over90" ? "days90Plus" : band;
}

/**
 * Money by band, as the endpoints hand it over.
 *
 * `days120Plus` is the arrears endpoint's name for the 90+ column — it has
 * always held everything past ninety days — and is read here rather than at
 * three call sites, so no screen has to know that the key and the column
 * disagree.
 */
export type AgeingAmounts = Partial<Record<AgeingBucketKey, number>> & {
  days120Plus?: number;
};

export type AgeingBand = AgeingBucket & { amount: number };

/** What is sitting in one band. */
export function ageingAmount(
  amounts: AgeingAmounts | null | undefined,
  key: AgeingBucketKey,
): number {
  if (key === "days90Plus") return amounts?.days90Plus ?? amounts?.days120Plus ?? 0;
  return amounts?.[key] ?? 0;
}

/** The five bands, in order, ready to label and draw. */
export function ageingBands(amounts: AgeingAmounts | null | undefined): AgeingBand[] {
  return AGEING_BUCKETS.map((bucket) => ({
    ...bucket,
    amount: ageingAmount(amounts, bucket.key),
  }));
}
