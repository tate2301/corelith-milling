import type { CorelithExtension } from "@/lib/extensions/types";

import { MILLING_LISTS } from "./lists";
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
      // customer list (deliveries and debtors need it) and sells at the gate
      // through core's fiscalised till (canvas GT): the till, its sales,
      // shifts and cash-ups, the catalogue and price lists, and the till's
      // portal. It buys maize through intake, not the shop's buying, and runs
      // no promotions. The mine's daily capture screens never reach another
      // vertical.
      disabledFeatureKeys: [
        "ops.shift-report.submit",
        "ops.attendance.mark",
        "ops.plant-report.submit",
        "reports.shift",
        "reports.attendance",
        "reports.plant",
        "retail.purchasing",
        "retail.promotions",
        "crm.core",
        "crm.leads",
        "crm.clients",
        "crm.appointments",
        "crm.intake",
        "crm.documents",
        "crm.insights",
        "crm.commissions",
        "crm.settings",
        "portal.schools",
        "schools.core",
      ],
    },
  ],
  reports: [...MILLING_REPORTS, ...MILLING_LISTS],
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
  // The canvas's navigation (NV01–NV04): the mill first, then the shared
  // modules as the canvas names them. The mill adds rows to Stores and
  // Maintenance rather than keeping its own copies, and its settings link to
  // the Management rows that already hold sites, approvals and numbering.
  nav: {
    label: "The mill",
    nodes: [
      { id: "milling.home", label: "Overview", icon: "home", href: "/milling" },
      { id: "milling.intake", label: "Intake", icon: "purchase-order-check", href: "/milling/intake" },
      {
        id: "milling.production",
        label: "Production",
        icon: "plant",
        href: "/milling/production",
        kids: [
          { id: "milling.runs", label: "Runs", icon: "plant", href: "/milling/production" },
          { id: "milling.plan", label: "Plan", icon: "calendar", href: "/milling/plan" },
          { id: "milling.shifts", label: "Shifts", icon: "shift", href: "/milling/shifts" },
          { id: "milling.packing", label: "Packing", icon: "checks", href: "/milling/packing" },
          { id: "milling.downtime", label: "Downtime", icon: "alert-circle", href: "/milling/downtime" },
          { id: "milling.generator", label: "Generator log", icon: "activity", href: "/milling/generator" },
        ],
      },
      { id: "milling.quality", label: "Quality", icon: "seal-check", href: "/milling/quality" },
      { id: "milling.sales", label: "Bag sales", icon: "receipt", href: "/milling/sales" },
      {
        id: "milling.despatch",
        label: "Despatch",
        icon: "dispatch",
        href: "/milling/deliveries",
        kids: [
          { id: "milling.deliveries", label: "Despatches", icon: "dispatch", href: "/milling/deliveries" },
          { id: "milling.trips", label: "Trips", icon: "activity", href: "/milling/trips" },
          { id: "milling.routes", label: "Routes", icon: "link", href: "/milling/routes" },
          { id: "milling.orders", label: "Orders", icon: "purchase-order", href: "/milling/orders" },
          { id: "milling.sellers", label: "Sellers", icon: "employee", href: "/milling/sellers" },
          { id: "milling.seller-trips", label: "Seller trips", icon: "receipt", href: "/milling/sellers/trips" },
        ],
      },
      { id: "milling.exceptions", label: "Exceptions", icon: "alert-circle", href: "/milling/exceptions" },
      {
        id: "milling.reports",
        label: "Reports",
        icon: "chart-bar",
        href: "/milling/reports",
        kids: [
          { id: "milling.director", label: "Yesterday at a glance", icon: "chart-line", href: "/milling/director" },
          { id: "milling.r-daily", label: "Daily operations report", icon: "chart-bar", href: "/milling/reports/milling-daily-operations" },
          { id: "milling.r-production", label: "Maize to production", icon: "chart-bar", href: "/milling/reports/milling-production" },
          { id: "milling.r-quality", label: "Quality results", icon: "chart-bar", href: "/milling/reports/milling-qc" },
          { id: "milling.r-downtime", label: "Downtime hours", icon: "chart-bar", href: "/milling/reports/milling-downtime" },
          { id: "milling.r-generator", label: "Fuel and generators", icon: "chart-bar", href: "/milling/reports/milling-generator" },
          { id: "milling.r-stock", label: "Stock", icon: "chart-bar", href: "/milling/reports/milling-stock" },
          { id: "milling.r-intake", label: "Intake and deductions", icon: "chart-bar", href: "/milling/reports/milling-intake" },
          { id: "milling.trace", label: "Trace", icon: "link", href: "/milling/trace" },
          { id: "milling.r-all", label: "All mill reports", icon: "rows", href: "/milling/reports" },
        ],
      },
      {
        id: "milling.settings",
        label: "Settings",
        icon: "checklist",
        href: "/milling/settings/general",
        kids: [
          { id: "milling.s-lines", label: "Mill lines", icon: "plant", href: "/milling/settings/stages" },
          { id: "milling.s-recipes", label: "Pack recipes", icon: "checks", href: "/milling/settings/recipes" },
          { id: "milling.s-rules", label: "Intake rules", icon: "purchase-order-check", href: "/milling/settings/general" },
          { id: "milling.s-specs", label: "Specs", icon: "seal-check", href: "/milling/settings/qc-specs" },
          { id: "milling.s-bins", label: "Bins and stores", icon: "stockroom", href: "/milling/settings/locations" },
          { id: "milling.s-vehicles", label: "Vehicles", icon: "dispatch", href: "/milling/settings/vehicles" },
          { id: "milling.s-destinations", label: "Destinations", icon: "link", href: "/milling/settings/destinations" },
          { id: "milling.s-duties", label: "Shift duties", icon: "shift", href: "/milling/settings/duties" },
          { id: "milling.s-groups", label: "Who does what", icon: "people", href: "/milling/settings/groups" },
          { id: "milling.s-shop", label: "Gate sales shop", icon: "receipt", href: "/milling/settings/shop" },
          { id: "milling.s-go-live", label: "Go-live", icon: "checks", href: "/milling/go-live" },
          { id: "milling.s-sites", label: "Sites and sections", icon: "site", href: "/preferences/organization/sites", management: "sites" },
          { id: "milling.s-approvals", label: "Approvals", icon: "approval", href: "/retail/manage/approvals", management: "approvals" },
          { id: "milling.s-numbering", label: "Numbering", icon: "numbering", href: "/books/settings/numbering", management: "bnum" },
          { id: "milling.s-schedules", label: "Report schedules", icon: "reports", href: "/management/reports", management: "reports" },
        ],
      },
    ],
    additions: [
      { into: "stock", id: "milling.lots", label: "Lots and bins", icon: "stockroom", href: "/milling/stock" },
      { into: "stock", id: "milling.lot-movements", label: "Lot movements", icon: "activity", href: "/milling/stock/movements" },
      { into: "stock", id: "milling.lot-counts", label: "Lot counts", icon: "checks", href: "/milling/stock/counts" },
      // Gate sales (NV02, GT): core's till and its price lists, beside core's sales and cash-ups.
      { into: "tender", id: "milling.till", label: "Till", icon: "receipt", href: "/milling/gate-till" },
      { into: "tender", id: "milling.price-lists", label: "Price lists", icon: "price-list", href: "/milling/price-lists" },
      // Customers (NV02): the mill adds visits, surveys and collections beside core's customer list.
      { into: "records", id: "milling.rep", label: "Today's route", icon: "link", href: "/milling/rep" },
      { into: "records", id: "milling.visits", label: "Visits", icon: "calendar-check", href: "/milling/visits" },
      { into: "records", id: "milling.surveys", label: "Surveys", icon: "checklist", href: "/milling/surveys" },
      { into: "records", id: "milling.collections", label: "Collections", icon: "money", href: "/milling/collections" },
      { into: "assets", id: "milling.machines", label: "Machine release", icon: "job-card", href: "/milling/maintenance" },
    ],
    order: ["ext.milling", "stock", "tender", "records", "books", "assets", "people", "insights"],
    labels: {
      groups: { stock: "Stores", tender: "Gate sales", records: "Customers", assets: "Maintenance", insights: "Reports" },
      rows: { onhand: "Stock", everyone: "Employees", rosters: "Roster", timeoff: "Leave", shifts: "Cash-up" },
    },
  },
};
