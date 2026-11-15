import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { kilogramsOf, tonnesOf } from "./weight";

describe("weight of a quantity", () => {
  it("reads kilograms and tonnes as weights already", () => {
    expect(kilogramsOf(250, "KILOGRAM", null)?.toString()).toBe("250");
    expect(kilogramsOf("1.5", "TONNE", null)?.toString()).toBe("1500");
    expect(tonnesOf(30, "TONNE", null)?.toString()).toBe("30");
  });

  it("weighs counted units by their net weight, exactly", () => {
    expect(kilogramsOf(120, "BAG", 10)?.toString()).toBe("1200");
    expect(tonnesOf(120, "BAG", 10)?.toString()).toBe("1.2");
    expect(tonnesOf(3, "BAG", new Prisma.Decimal("12.5"))?.toString()).toBe("0.0375");
    expect(tonnesOf(7, "EACH", "0.1")?.toString()).toBe("0.0007");
  });

  it("does not guess when a counted unit has no weight", () => {
    expect(kilogramsOf(120, "BAG", null)).toBeNull();
    expect(tonnesOf(5, "EACH", undefined)).toBeNull();
  });
});
