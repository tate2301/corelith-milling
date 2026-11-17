import { describe, expect, it } from "vitest";

import { getClientTemplateFeatureKeys } from "@/lib/platform/client-templates";
import { reportCatalog } from "@/lib/reports/catalog";
import { REPORT_DEFINITIONS } from "@/lib/reports/registry";

const mill = getClientTemplateFeatureKeys("TEMPLATE_MILLING");
const keysFor = (role: string) =>
  reportCatalog(REPORT_DEFINITIONS, { role, enabledFeatures: mill }, "GENERAL").flatMap((area) => area.reports.map((report) => report.key));

describe("the mill's reports in the catalogue", () => {
  it("are listed for the mill's managers", () => {
    expect(keysFor("MANAGER")).toEqual(expect.arrayContaining(["milling-daily-operations", "milling-production", "milling-despatches"]));
  });

  it("are not shown to a role pinned to the CRM", () => {
    expect(keysFor("SALES_REP").filter((key) => key.startsWith("milling-"))).toEqual([]);
  });
});
