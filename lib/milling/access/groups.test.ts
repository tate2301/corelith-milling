import { describe, expect, it } from "vitest";

import { MILL_CAPABILITIES, MILL_GROUP_CODES, MILL_GROUPS, MONEY_CAPABILITIES, millAccessFor } from "./groups";

describe("the mill's permission groups", () => {
  it("are the spec's groups, the canvas's sales rep and director, and Grandmeal's accountant, marketing agent, security and auditor, each with something to do but the director, who reads", () => {
    expect(MILL_GROUPS.map((group) => group.code)).toEqual([...MILL_GROUP_CODES]);
    for (const group of MILL_GROUPS) {
      if (group.code === "DIRECTOR") expect(group.capabilities).toEqual([]);
      else expect(group.capabilities.length).toBeGreaterThan(0);
    }
  });

  it("leave no capability that nobody can be given", () => {
    const granted = new Set(MILL_GROUPS.flatMap((group) => group.capabilities));
    expect(MILL_CAPABILITIES.filter((capability) => !granted.has(capability))).toEqual([]);
  });

  it("give the owner everything without a group, and a manager everything but the money", () => {
    expect(millAccessFor("SUPERADMIN", [])).toMatchObject({ canView: true, capabilities: [...MILL_CAPABILITIES] });
    const manager = millAccessFor("MANAGER", []);
    expect(manager.canView).toBe(true);
    for (const money of MONEY_CAPABILITIES) expect(manager.capabilities).not.toContain(money);
    expect(manager.capabilities).toContain("delivery.manage");
    expect(millAccessFor("MANAGER", ["ACCOUNTANT"]).capabilities).toEqual(expect.arrayContaining([...MONEY_CAPABILITIES]));
  });

  it("keep money to accounting, and a marketing agent to logging orders", () => {
    for (const group of MILL_GROUPS) {
      if (["ACCOUNTANT", "AUDITOR"].includes(group.code)) continue;
      expect(group.capabilities.filter((capability) => MONEY_CAPABILITIES.includes(capability)), group.code).toEqual([]);
    }
    expect(millAccessFor("CLERK", ["MARKETING"]).capabilities).toEqual(["order.log"]);
    expect(millAccessFor("CLERK", ["SALES_REP"]).capabilities).not.toContain("order.close");
  });

  it("give anyone else the union of their groups, and nothing without one", () => {
    expect(millAccessFor("CLERK", [])).toEqual({ canView: false, groups: [], capabilities: [] });

    const both = millAccessFor("CLERK", ["QUALITY", "STORES", "NOT_A_GROUP"]);
    expect(both.groups).toEqual(["STORES", "QUALITY"]);
    expect(both.capabilities).toEqual(["intake.record", "stock.move", "stock.count", "qc.record", "qc.decide", "seller.manage", "sale.record"]);
    expect(millAccessFor("CLERK", ["SALES_REP"]).capabilities).toEqual(["order.work", "voucher.issue", "visit.record", "collection.record", "sale.record"]);
    expect(millAccessFor("CLERK", ["DIRECTOR"])).toMatchObject({ canView: true, capabilities: [] });
    expect(both.capabilities).not.toContain("exception.decide");
  });

  it("keep a driver to their own deliveries and fuel", () => {
    expect(millAccessFor("OPERATOR", ["DRIVER"]).capabilities).toEqual(["delivery.own", "fuel.record"]);
  });
});
