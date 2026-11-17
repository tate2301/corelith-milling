/**
 * How late money owed is: one ageing for every module that ages debts.
 *
 * Books' "Owed to you, by age", the CRM's collections and a school's arrears
 * used to keep three copies of the same five bands, with three spellings and
 * two ways of counting days. A customer who owes the business through Books
 * and the CRM was "31 to 60 days" on one screen and "31–60 days" on the
 * other, and only one of the copies counted a bill as late on its due date.
 *
 * **A balance that falls due today is not yet late.** Days are whole days
 * from the due date, so a bill leaves the first band at midnight after the
 * day it is due. A bill with no due date is not late at all: that is a
 * billing mistake, and treating it as ancient would put the largest figure
 * on the screen in its worst column.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The five bands, in order. */
export const AGE_BAND_KEYS = ["current", "days30", "days60", "days90", "over90"] as const;
export type AgeBandKey = (typeof AGE_BAND_KEYS)[number];

/** Each band's words, the same on every screen. */
export const AGE_BAND_LABELS: Record<AgeBandKey, string> = {
  current: "Not yet due",
  days30: "1 to 30 days",
  days60: "31 to 60 days",
  days90: "61 to 90 days",
  over90: "Over 90 days",
};

/** Whole days past the due date: zero on the day itself, negative before it, zero with no date. */
export function daysPastDue(dueDate: Date | string | null | undefined, asOf: Date = new Date()): number {
  if (!dueDate) return 0;
  const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(due.getTime())) return 0;
  return Math.floor((asOf.getTime() - due.getTime()) / DAY_MS);
}

/** The band for a balance that many whole days past due. */
export function ageBand(daysOverdue: number): AgeBandKey {
  if (!Number.isFinite(daysOverdue) || daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "days30";
  if (daysOverdue <= 60) return "days60";
  if (daysOverdue <= 90) return "days90";
  return "over90";
}
