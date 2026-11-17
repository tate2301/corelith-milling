import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { checkSettingsChanges, settingsPage } from "@/lib/retail/settings-pages";
import { companyPage } from "@/lib/retail/settings-pages/company";
import { SETTINGS_RESOURCES } from "./fields";
import { MILL_SETTINGS_SECTIONS, RETAIL_SETTINGS_SECTIONS, RETAIL_SETUP_STEPS, millSettingsSection } from "./navigation";
import { millRetailCompanyPage } from "./retail-company";

describe("mill settings navigation", () => {
  it("preserves each resource and keeps retail deep links in the retail section", () => {
    for (const resource of SETTINGS_RESOURCES) expect(MILL_SETTINGS_SECTIONS.some((section) => section.href === `/milling/settings/${resource.key}`)).toBe(true);
    expect(millSettingsSection("/milling/settings/shop/payments")?.label).toBe("Retail shop");
    expect(millSettingsSection("/milling/settings/recipes")?.label).toBe(SETTINGS_RESOURCES.find((resource) => resource.key === "recipes")?.label);
    expect(millSettingsSection("/milling/settings/shop-other")).toBeUndefined();
  });

  it("uses existing retail settings records and real operational destinations", () => {
    for (const section of RETAIL_SETTINGS_SECTIONS) expect(settingsPage(section.key)).not.toBeNull();
    for (const step of RETAIL_SETUP_STEPS) {
      if (step.href.startsWith("/milling/settings/shop/")) {
        expect(RETAIL_SETTINGS_SECTIONS.some((section) => step.href === `/milling/settings/shop/${section.key}`)).toBe(true);
      } else expect(existsSync(join(process.cwd(), "app", step.href, "page.tsx")), step.href).toBe(true);
    }
  });

  it("reuses business validation without allowing workspace-profile changes from mill retail setup", () => {
    expect(millRetailCompanyPage.sections.some((section) => section.fields.some((field) => field.id === "workspaceProfile"))).toBe(false);
    expect(checkSettingsChanges(millRetailCompanyPage, { workspaceProfile: "RETAIL" }).ok).toBe(false);
    for (const values of [{ businessType: "General retail" }, { whatsapp: "+263771234567" }, { vatRegistered: false }, { currency: "ZiG" }]) {
      expect(checkSettingsChanges(millRetailCompanyPage, values)).toEqual(checkSettingsChanges(companyPage, values));
    }
    expect(companyPage.sections.some((section) => section.fields.some((field) => field.id === "workspaceProfile"))).toBe(true);
  });
});
