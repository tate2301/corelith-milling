import { describe, expect, it } from "vitest";

import { featureGrantHeld } from "./feature-grants";

describe("feature grants", () => {
  it("holds a maintenance grant while that very feature is on", () => {
    expect(featureGrantHeld(["maintenance.work-orders", "update"], ["maintenance.work-orders"])).toBe(true);
    expect(featureGrantHeld(["maintenance.work-orders", "update"], ["maintenance.equipment"])).toBe(false);
    expect(featureGrantHeld(["maintenance.work-orders", "view"], null)).toBe(false);
  });

  it("keeps CRM and Stores module-wide", () => {
    expect(featureGrantHeld(["stores.inventory", "view"], ["stores.catalogue"])).toBe(true);
    expect(featureGrantHeld(["crm.core", "view"], ["stores.catalogue"])).toBe(false);
  });

  it("leaves every other grant to its own rule", () => {
    expect(featureGrantHeld(["retail.stock", "view"], ["maintenance.work-orders"])).toBeNull();
    expect(featureGrantHeld(["ext:milling", "view"], [])).toBeNull();
  });
});
