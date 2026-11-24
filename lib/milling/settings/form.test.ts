import { describe, expect, it } from "vitest";
import { getSettingsResource } from "./fields";
import { passingRule, settingsPayload, settingsStartingValues, shownSettingsFields } from "./form";

describe("milling setup form rules", () => {
  it("starts quality checks as an explained pass/fail check and hides limits until numeric is selected", () => {
    const resource = getSettingsResource("qc-specs")!;
    const values = settingsStartingValues(resource, null);
    expect(values).toMatchObject({ point: "INCOMING_MAIZE", method: "VISUAL", resultType: "PASS_FAIL" });
    expect(shownSettingsFields(resource.fields, values, true).some((field) => field.key === "minValue")).toBe(false);
    expect(shownSettingsFields(resource.fields, { ...values, resultType: "NUMERIC" }, true).some((field) => field.key === "minValue")).toBe(true);
    expect(settingsPayload(resource, { ...values, unit: "%", minValue: "0", maxValue: "10" }, true)).toMatchObject({ minValue: null, maxValue: null, unit: null });
  });

  it("never posts display-only or immutable source identities on edit", () => {
    const recipe = getSettingsResource("recipes")!;
    const values = settingsStartingValues(recipe, { id: "r", packedProductId: "p", bulkProductId: "b", packed: "Meal", bulk: "Bulk", kgPerBag: 10 });
    const payload = settingsPayload(recipe, values, false);
    expect(payload).not.toHaveProperty("packedProductId"); expect(payload).not.toHaveProperty("packed"); expect(payload).not.toHaveProperty("bulk");
    expect(payload).toMatchObject({ bulkProductId: "b", kgPerBag: "10" });
    const location = getSettingsResource("locations")!;
    expect(shownSettingsFields(location.fields, {}, false).some((field) => field.key === "siteId")).toBe(false);
  });

  it("explains one-sided and two-sided inclusive passing limits including zero", () => {
    expect(passingRule({ resultType: "NUMERIC", minValue: 0, maxValue: 12.5, unit: "%" })).toBe("0 to 12.5 % (inclusive)");
    expect(passingRule({ resultType: "NUMERIC", maxValue: 12.5, unit: "%" })).toBe("At most 12.5 %");
    expect(passingRule({ resultType: "NUMERIC", minValue: 0 })).toBe("At least 0");
  });
});
