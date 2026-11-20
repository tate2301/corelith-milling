import { describe, expect, it } from "vitest";

import { registeredExtensions } from "@/extensions";
import { composeNav } from "@/lib/nav/compose";
import { canOpenFor, navLayoutFor, visibleAddresses } from "@/lib/nav/gate";
import { getClientTemplateFeatureKeys } from "@/lib/platform/client-templates";
import { getBundleDefinition } from "@/lib/platform/feature-catalog";
import { resolveFeatureKeyForPath } from "@/lib/platform/gating/route-registry";
import { resolveVerticalDefaults } from "@/lib/platform/vertical-defaults";
import { getVerticalProductBundleForTemplate, resolveWorkspaceVerticalProductBundle } from "@/lib/workspace-products";

/**
 * The milling vertical as the app reads it: through core's catalogues, with
 * the real `extensions/index.ts`, not a stand-in. Core's own contract test
 * proves the seams; this proves the mill is plugged into them.
 */
describe("the milling vertical", () => {
  const provisioned = getClientTemplateFeatureKeys("TEMPLATE_MILLING");
  const manager = { role: "MANAGER", enabledFeatures: provisioned, workspaceProfile: "GENERAL" };

  it("is registered", () => {
    expect(registeredExtensions.map((extension) => extension.id)).toEqual(["milling"]);
    expect(getBundleDefinition("ADDON_MILLING")?.features).toEqual(["milling.home"]);
  });

  it("is provisioned with the mill's modules and none of the shop, school or mine screens", () => {
    expect(provisioned).toEqual(
      expect.arrayContaining([
        "milling.home",
        "stores.inventory",
        "hr.attendance",
        "hr.payroll",
        "maintenance.equipment",
        "accounting.core",
        "crm.customers",
      ]),
    );
    const stray = provisioned.filter((key) => /^(retail|schools|gold|portal)\./.test(key) || key.startsWith("ops."));
    expect(stray).toEqual([]);
  });

  it("gates /milling on its feature", () => {
    expect(resolveFeatureKeyForPath("/milling")).toBe("milling.home");
  });

  it("is the workspace's product, opening on /milling", () => {
    const product = resolveWorkspaceVerticalProductBundle({ workspaceProfile: "GENERAL", enabledFeatures: provisioned });
    expect(product.id).toBe("ext.milling");
    expect(product.workspaceLabel).toBe("The mill");
    expect(product.preferredHomeHref).toBe("/milling");
    expect(getVerticalProductBundleForTemplate("TEMPLATE_MILLING")?.id).toBe("ext.milling");
  });

  it("lays the sidebar out as the canvas draws it (NV01, NV02)", () => {
    const open = visibleAddresses(manager);
    expect(open.has("/milling")).toBe(true);
    const layout = navLayoutFor(open, "GENERAL");
    expect(layout.products[0]).toBe("ext.milling");
    const groups = composeNav({ canOpen: canOpenFor(manager), ...layout });
    const mill = groups.find((group) => group.id === "ext.milling");
    expect(mill?.label).toBe("The mill");
    expect(mill?.items.map((item) => item.label)).toEqual([
      "Overview",
      "Intake",
      "Production",
      "Quality",
      "Despatch",
      "Exceptions",
      "Reports",
      "Settings",
    ]);
    const production = mill?.items.find((item) => item.label === "Production");
    expect(production?.kids?.map((kid) => kid.label)).toEqual(["Runs", "Plan", "Shifts", "Packing", "Downtime", "Generator log"]);

    // The mill comes first, then the shared modules under the canvas's names.
    const named = groups.filter((group) => group.id !== "top").map((group) => group.label);
    expect(named[0]).toBe("The mill");
    expect(named).toEqual(expect.arrayContaining(["Stores", "Maintenance"]));

    // Lots and bins join Stores; machine release joins Maintenance. No copies.
    const stores = groups.find((group) => group.label === "Stores");
    expect(stores?.items.map((item) => item.href)).toEqual(expect.arrayContaining(["/milling/stock"]));
    expect(stores?.items.find((item) => item.href === "/retail/stock")?.label).toBe("Stock");
    const maintenance = groups.find((group) => group.label === "Maintenance");
    expect(maintenance?.items.map((item) => item.href)).toEqual(expect.arrayContaining(["/milling/maintenance"]));
  });

  it("forwards every report row to a report the mill registers", () => {
    const keys = new Set((registeredExtensions[0]?.reports ?? []).map((report) => report.key));
    const reports = registeredExtensions[0]?.nav?.nodes.find((node) => node.id === "milling.reports");
    for (const kid of reports?.kids ?? []) {
      const key = kid.href.match(/^\/milling\/reports\/(.+)$/)?.[1];
      if (key) expect(keys.has(key)).toBe(true);
    }
  });

  it("offers the mill's equipment categories to maintenance", () => {
    const categories = resolveVerticalDefaults({ workspaceProfile: "GENERAL", enabledFeatures: provisioned }).maintenance
      .equipmentCategories;
    expect(categories).toEqual(expect.arrayContaining(["ROLLER_MILL", "DEGERMINATOR", "SIFT_BOX", "VEHICLE"]));
    expect(categories.at(-1)).toBe("OTHER");
  });
});
