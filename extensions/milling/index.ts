import type { CorelithExtension } from "@/lib/extensions/types";

import { MILLING_REPORTS } from "./reports";

/**
 * The milling vertical: a maize mill that receives grain, mills it, packs meal
 * and by-products, and sells and delivers them.
 *
 * One feature, `milling.home`, opens the whole mill to a tenant; inside it,
 * who may do what is decided by the mill's permission groups
 * (lib/milling/access, DECISIONS.md D3). Its reports are in `./reports.ts`
 * and their loaders, which query, in `./loaders.ts` (registered in
 * extensions/server.ts).
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
    apis: [{ prefix: "/api/milling/", featureKey: "milling.home" }],
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
  reports: MILLING_REPORTS,
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
    // The plant, in process order (lib/milling/setup/mill.ts), then the fleet
    // and the generator. VEHICLE and POWER are declared here too: with
    // Zimbabwe payroll on, core reads a GENERAL workspace's defaults as the
    // payroll bureau's, whose list lacks them.
    equipmentCategories: [
      "AUGER",
      "PRE_CLEANER",
      "DESTONER",
      "CONDITIONING",
      "BIN",
      "DEGERMINATOR",
      "ASPIRATOR",
      "ELEVATOR",
      "PNEUMATIC_CONVEYOR",
      "AIRLOCK",
      "ROLLER_MILL",
      "SIFT_BOX",
      "SEWING_MACHINE",
      "INSTRUMENT",
      "VEHICLE",
      "POWER",
    ],
  },
  nav: {
    label: "The mill",
    nodes: [
      { id: "milling.home", label: "Overview", icon: "home", href: "/milling" },
      { id: "milling.plan", label: "Plan", icon: "calendar", href: "/milling/plan" },
      { id: "milling.shifts", label: "Shifts", icon: "shift", href: "/milling/shifts" },
      { id: "milling.intake", label: "Intake", icon: "purchase-order-check", href: "/milling/intake" },
      { id: "milling.production", label: "Production", icon: "plant", href: "/milling/production" },
      { id: "milling.quality", label: "Quality", icon: "seal-check", href: "/milling/quality" },
      { id: "milling.packing", label: "Packing", icon: "checks", href: "/milling/packing" },
      { id: "milling.stock", label: "Stock", icon: "stockroom", href: "/milling/stock" },
      { id: "milling.orders", label: "Orders", icon: "purchase-order", href: "/milling/orders" },
      { id: "milling.deliveries", label: "Deliveries", icon: "dispatch", href: "/milling/deliveries" },
      { id: "milling.machines", label: "Machines", icon: "job-card", href: "/milling/maintenance" },
      { id: "milling.exceptions", label: "Exceptions", icon: "alert-circle", href: "/milling/exceptions" },
      { id: "milling.trace", label: "Trace", icon: "link", href: "/milling/trace" },
      { id: "milling.reports", label: "Reports", icon: "chart-bar", href: "/milling/reports" },
      { id: "milling.settings", label: "Settings", icon: "checklist", href: "/milling/settings" },
    ],
  },
};
