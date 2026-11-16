import { describe, expect, it } from "vitest";

import { milling } from "@/extensions/milling";
import { getClientTemplateFeatureKeys } from "@/lib/platform/client-templates";
import { isEquipmentCategoryAllowed } from "@/lib/maintenance/equipment-categories";

import { MILL_EQUIPMENT, MILL_LOCATIONS, MILL_PRODUCTS } from "./mill";

const unique = (codes: string[]) => new Set(codes).size === codes.length;

describe("the mill a workspace starts with", () => {
  it("has unique codes, as the seed keys every row on its code", () => {
    expect(unique(MILL_LOCATIONS.map((location) => location.code))).toBe(true);
    expect(unique(MILL_EQUIPMENT.map((machine) => machine.code))).toBe(true);
    expect(unique(MILL_PRODUCTS.map((product) => product.code))).toBe(true);
  });

  it("puts every machine in one of its locations", () => {
    const locations = new Set(MILL_LOCATIONS.map((location) => location.code));
    expect(MILL_EQUIPMENT.filter((machine) => !locations.has(machine.location))).toEqual([]);
  });

  it("files every machine under a category maintenance will save", () => {
    const enabledFeatures = getClientTemplateFeatureKeys("TEMPLATE_MILLING");
    const refused = MILL_EQUIPMENT.filter(
      (machine) => !isEquipmentCategoryAllowed({ category: machine.category, workspaceProfile: "GENERAL", enabledFeatures }),
    );
    expect(refused).toEqual([]);
  });

  it("uses every plant category the mill adds (POWER waits for the generator's details)", () => {
    const used = new Set(MILL_EQUIPMENT.map((machine) => machine.category));
    const unused = (milling.defaults?.equipmentCategories ?? []).filter((category) => !used.has(category));
    expect(unused).toEqual(["POWER"]);
  });

  it("weighs every bag, so tonnage is never guessed", () => {
    const bags = MILL_PRODUCTS.filter((product) => product.unit === "BAG");
    expect(bags.map((product) => [product.code, product.netWeightKg])).toEqual([
      ["MEAL-5", 5],
      ["MEAL-10", 10],
      ["BRAN-25", 25],
      ["GEM-40", 40],
      ["POWDER-50", 50],
    ]);
  });

  it("has the fleet: two UD trucks and the Hyundai", () => {
    expect(MILL_EQUIPMENT.filter((machine) => machine.category === "VEHICLE").map((machine) => machine.name)).toEqual([
      "UD truck 1",
      "UD truck 2",
      "Hyundai",
    ]);
  });
});
