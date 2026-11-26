import { SETTINGS_RESOURCES } from "./fields";

/** Route-backed settings sections; shared by navigation and page selection. */
export const MILL_SETTINGS_SECTIONS = [
  { href: "/milling/settings/general", label: "Shift and tolerances" },
  ...SETTINGS_RESOURCES.map((resource) => ({ href: `/milling/settings/${resource.key}`, label: resource.label })),
  { href: "/milling/settings/groups", label: "Groups and access" },
  { href: "/milling/settings/shop", label: "Retail shop" },
] as const;

export const RETAIL_SETTINGS_SECTIONS = [
  { key: "company", label: "Business and shop kind" },
  { key: "payments", label: "Payments and currencies" },
  { key: "receipts", label: "Receipts" },
  { key: "fiscal", label: "Fiscal device" },
  { key: "posting", label: "Posting to the books" },
  { key: "approvals", label: "Approvals" },
] as const;

export function millSettingsSection(pathname: string) {
  return MILL_SETTINGS_SECTIONS.find((section) => pathname === section.href || pathname.startsWith(`${section.href}/`));
}

/** Existing, working configuration screens; these do not claim that a shop is ready from a link being visited. */
export const RETAIL_SETUP_STEPS = [
  { label: "Business and base currency", detail: "Check VAT and the currency before recording sales.", href: "/milling/settings/shop/company" },
  { label: "Products and pack sizes", detail: "Each bag the mill sells, with its net weight.", href: "/retail/products" },
  { label: "Price lists", detail: "Set a price for each bag on the default list; Sell charges from it.", href: "/milling/price-lists" },
  { label: "Opening stock", detail: "Count the packed bags in each store before the first sale.", href: "/milling/go-live" },
  { label: "Who may sell", detail: "Give Sales reps and Stores the Sell right in Who does what.", href: "/milling/settings/groups" },
  { label: "Fiscal device", detail: "Connect the fiscal device so invoices are fiscalised when sales post to Books.", href: "/milling/settings/shop/fiscal" },
  { label: "Posting to the books", detail: "Set up the money accounts that cash and EcoCash go into.", href: "/milling/settings/shop/posting" },
  { label: "Start selling", detail: "Gate sales › Sell, at the office or from a seller's bags. No till or pos address is needed.", href: "/milling/sales" },
] as const;
