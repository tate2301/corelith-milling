import type { CorelithExtension } from "@/lib/extensions/types";

/**
 * The milling vertical: a maize mill that receives grain, mills it, packs meal
 * and by-products, and sells and delivers them.
 *
 * This first version registers the vertical and nothing else: a feature, its
 * bundle, the template a mill is provisioned from, the "The mill" sidebar
 * group and its home page. Each workflow (intake, production, quality,
 * packing, despatch) adds its own feature, routes and rows here as it lands.
 *
 * Plain data only: this file is on the proxy's import path.
 */
export const milling: CorelithExtension = {
  id: "milling",
  label: "Milling",
  features: [
    {
      key: "milling.home",
      name: "Mill overview",
      description: "The mill's home: what is running, held and due today.",
      defaultEnabled: false,
    },
  ],
  bundles: [
    {
      code: "ADDON_MILLING",
      name: "Milling",
      description: "Grain intake, production, quality, packing and despatch for a mill.",
      features: ["milling.home"],
    },
  ],
  bundleDependencies: { ADDON_MILLING: ["ADDON_STORES_CORE"] },
  routes: {
    pages: [{ prefix: "/milling", featureKey: "milling.home" }],
  },
  templates: [
    {
      code: "TEMPLATE_MILLING",
      label: "Grain milling",
      description: "Intake, production, packing, stock, maintenance, people and books for a grain mill.",
      targetClients: ["Maize mill", "Grain milling and packing"],
      recommendedTierCode: "ENTERPRISE",
      bundleCodes: [
        "ADDON_OPERATIONS_CORE",
        "ADDON_STORES_CORE",
        "ADDON_WORKFORCE_CORE",
        "ADDON_ADVANCED_PAYROLL",
        "ADDON_ZIMBABWE_PAYROLL",
        "ADDON_MAINTENANCE_PRO",
        "ADDON_ACCOUNTING_CORE",
        "ADDON_BOOKS_SCREENS",
        "ADDON_ACCOUNTING_ADVANCED",
        "ADDON_ZIMRA_FISCAL",
        "ADDON_ANALYTICS_PRO",
        "ADDON_MILLING",
      ],
      featureKeys: [],
      verticalProductId: "general-business",
      // ENTERPRISE carries the shop, CRM and portal suites. A mill keeps the
      // customer list (deliveries and debtors need it) and turns off the rest
      // until gate sales are built for it. The mine's daily capture screens
      // never reach another vertical.
      disabledFeatureKeys: [
        "ops.shift-report.submit",
        "ops.attendance.mark",
        "ops.plant-report.submit",
        "reports.shift",
        "reports.attendance",
        "reports.plant",
        "retail.core",
        "retail.pos",
        "retail.catalog",
        "retail.purchasing",
        "retail.promotions",
        "retail.shifts",
        "retail.reports",
        "crm.core",
        "crm.leads",
        "crm.clients",
        "crm.appointments",
        "crm.intake",
        "crm.documents",
        "crm.insights",
        "crm.commissions",
        "crm.settings",
        "portal.core",
        "portal.pos",
        "portal.schools",
        "schools.core",
      ],
    },
  ],
  product: {
    label: "Milling operations",
    workspaceLabel: "The mill",
    description: "A grain mill: intake, production, packing, stock and despatch.",
    customerExamples: ["Maize mill"],
    preferredHomeHref: "/milling",
    primaryModules: ["stores", "maintenance", "reporting"],
    foundationalModules: ["people", "payroll", "accounting"],
  },
  defaults: {
    equipmentCategories: [
      "CLEANER",
      "CONDITIONING_BIN",
      "DEGERMINATOR",
      "ROLLER_MILL",
      "HAMMER_MILL",
      "SIFTER",
      "SILO",
      "PACKER",
      "SEWING_MACHINE",
      "WEIGHBRIDGE",
    ],
  },
  nav: {
    label: "The mill",
    nodes: [{ id: "milling.home", label: "Overview", icon: "home", href: "/milling" }],
  },
};
