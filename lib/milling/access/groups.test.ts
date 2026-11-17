import { describe, expect, it } from "vitest";

import { MILL_CAPABILITIES, MILL_GROUP_CODES, MILL_GROUPS, millAccessFor } from "./groups";

describe("the mill's permission groups", () => {
  it("are the eight in the spec, each with something to do", () => {
    expect(MILL_GROUPS.map((group) => group.code)).toEqual([...MILL_GROUP_CODES]);
    for (const group of MILL_GROUPS) expect(group.capabilities.length).toBeGreaterThan(0);
  });

  it("leave no capability that nobody can be given", () => {
    const granted = new Set(MILL_GROUPS.flatMap((group) => group.capabilities));
    expect(MILL_CAPABILITIES.filter((capability) => !granted.has(capability))).toEqual([]);
  });

  it("give owners and managers everything without a group", () => {
    for (const role of ["SUPERADMIN", "MANAGER"]) {
      const access = millAccessFor(role, []);
      expect(access.canView).toBe(true);
      expect(access.capabilities).toEqual([...MILL_CAPABILITIES]);
    }
  });

  it("give anyone else the union of their groups, and nothing without one", () => {
    expect(millAccessFor("CLERK", [])).toEqual({ canView: false, groups: [], capabilities: [] });

    const both = millAccessFor("CLERK", ["QUALITY", "STORES", "NOT_A_GROUP"]);
    expect(both.groups).toEqual(["STORES", "QUALITY"]);
    expect(both.capabilities).toEqual(["intake.record", "stock.move", "stock.count", "qc.record", "qc.decide"]);
    expect(both.capabilities).not.toContain("exception.decide");
  });

  it("keep a driver to their own deliveries and fuel", () => {
    expect(millAccessFor("OPERATOR", ["DRIVER"]).capabilities).toEqual(["delivery.own", "fuel.record"]);
  });
});
