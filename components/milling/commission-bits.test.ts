import { describe, expect, it } from "vitest";

import { tripState, wouldCover } from "./commission-bits";

const trip = (code: string, earned: number, paid: number) => ({ id: code, code, date: "2026-11-01", products: [], earned, paid, due: earned - paid });

describe("what a commission payment covers", () => {
  // The statement lists trips newest first.
  const trips = [trip("ST-3", 8, 0), trip("ST-2", 10, 0), trip("ST-1", 10, 4)];

  it("pays the oldest commission first, and says which trips it clears", () => {
    expect(wouldCover(trips, 12)).toEqual([
      { code: "ST-1", amount: 6, clears: true },
      { code: "ST-2", amount: 6, clears: false },
    ]);
  });

  it("covers nothing for nothing, and stops at what is due", () => {
    expect(wouldCover(trips, 0)).toEqual([]);
    expect(wouldCover(trips, 100).reduce((sum, row) => sum + row.amount, 0)).toBe(24);
  });

  it("reads a trip as paid, part paid or due", () => {
    expect(trips.map(tripState)).toEqual(["DUE", "DUE", "PART"]);
    expect(tripState(trip("ST-0", 5, 5))).toBe("PAID");
  });
});
