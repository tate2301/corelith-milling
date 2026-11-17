import { describe, expect, it } from "vitest";

import { AGE_BAND_KEYS, AGE_BAND_LABELS, ageBand, daysPastDue } from "./ageing";
import { ageBucket, AGE_BUCKETS } from "./books/invoices";
import { AGEING_LABELS, ageingBucket } from "./crm/collections";
import { AGEING_BUCKETS, ageingBucket as schoolBucket } from "./schools/ageing";

const asOf = new Date("2026-11-17T12:00:00Z");
const daysBefore = (days: number) => new Date(asOf.getTime() - days * 86_400_000);

describe("one ageing", () => {
  it("counts whole days from the due date, with today and no date not late", () => {
    expect(daysPastDue(asOf, asOf)).toBe(0);
    expect(daysPastDue(daysBefore(31), asOf)).toBe(31);
    expect(daysPastDue(null, asOf)).toBe(0);
    expect(daysPastDue("nonsense", asOf)).toBe(0);
  });

  it("puts each boundary in the same band in Books, the CRM and Schools", () => {
    for (const [days, band] of [[-5, "current"], [0, "current"], [1, "days30"], [30, "days30"], [31, "days60"], [90, "days90"], [91, "over90"]] as const) {
      expect(ageBand(days)).toBe(band);
      expect(ageBucket(days)).toBe(AGE_BAND_LABELS[band]);
      expect(AGEING_LABELS[ageingBucket(daysBefore(days), asOf)]).toBe(AGE_BAND_LABELS[band]);
      expect(AGEING_BUCKETS.find((bucket) => bucket.key === schoolBucket(days))?.label).toBe(AGE_BAND_LABELS[band]);
    }
  });

  it("uses one set of words everywhere", () => {
    const words = AGE_BAND_KEYS.map((key) => AGE_BAND_LABELS[key]);
    expect([...AGE_BUCKETS]).toEqual(words);
    expect(Object.values(AGEING_LABELS)).toEqual(words);
    expect(AGEING_BUCKETS.map((bucket) => bucket.label)).toEqual(words);
  });
});
