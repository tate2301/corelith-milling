import { describe, expect, it } from "vitest";

import { bandedOvertimePay, isoWeekday, overtimeDay, type OvertimeBandRule } from "./overtime-bands";

const monday = new Date("2026-11-16T00:00:00Z");
const saturday = new Date("2026-11-21T00:00:00Z");

const bands: OvertimeBandRule[] = [
  { dayKind: "WORKDAY", fromHours: 0, toHours: 2, multiplier: 1.5 },
  { dayKind: "WORKDAY", fromHours: 2, toHours: null, multiplier: 2 },
  { dayKind: "REST_DAY", fromHours: 0, toHours: null, multiplier: 2 },
];

describe("overtime bands", () => {
  it("reads the kind of day from the mark and the person's rest days", () => {
    expect(isoWeekday(saturday)).toBe(6);
    expect(overtimeDay({ date: monday, status: "PRESENT" }, [6, 7])).toBe("WORKDAY");
    expect(overtimeDay({ date: saturday, status: "PRESENT" }, [6, 7])).toBe("REST_DAY");
    expect(overtimeDay({ date: monday, status: "REST_DAY" }, [])).toBe("REST_DAY");
    expect(overtimeDay({ date: saturday, status: "HOLIDAY" }, [6])).toBe("HOLIDAY");
  });

  it("splits each shift's hours across its day's bands", () => {
    // Monday 3.5 h at $4: 2 × 4 × 1.5 + 1.5 × 4 × 2 = 12 + 12 = 24.
    expect(bandedOvertimePay([{ date: monday, status: "PRESENT", hours: 3.5 }], bands, 4, [7]).toFixed(2)).toBe("24.00");
    // Two shifts are banded separately, not summed first: 2 × (1.5 × 4 × 1.5) = 18.
    const two = [1, 2].map(() => ({ date: monday, status: "PRESENT", hours: 1.5 }));
    expect(bandedOvertimePay(two, bands, 4, []).toFixed(2)).toBe("18.00");
    // A rest day pays every hour double: 5 × 4 × 2 = 40.
    expect(bandedOvertimePay([{ date: saturday, status: "PRESENT", hours: 5 }], bands, 4, [6]).toFixed(2)).toBe("40.00");
  });

  it("pays hours with no band at the rate, and everything at the rate with no bands", () => {
    expect(bandedOvertimePay([{ date: saturday, status: "HOLIDAY", hours: 3 }], bands, 4, []).toFixed(2)).toBe("12.00");
    expect(bandedOvertimePay([{ date: monday, status: "PRESENT", hours: 3.5 }], [], 4, []).toFixed(2)).toBe("14.00");
    expect(bandedOvertimePay([{ date: monday, status: "PRESENT", hours: 0 }], bands, 4, []).toFixed(2)).toBe("0.00");
  });
});
