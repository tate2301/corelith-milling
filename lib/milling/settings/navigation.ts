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
  { key: "till-rules", label: "Till rules" },
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
  { label: "Business, shop kind and base currency", detail: "Choose General retail for milling products; check VAT and the currency before recording sales.", href: "/milling/settings/shop/company" },
  { label: "Sites and stock locations", detail: "Create the selling branch and its stock location.", href: "/retail/manage/sites" },
  { label: "Products and selling prices", detail: "Add the items you sell and set a price on the default list.", href: "/retail/products" },
  { label: "Price lists", detail: "Create a default list if none exists, then any wholesale or other lists.", href: "/retail/products/price-lists" },
  { label: "Opening stock", detail: "Receive or count stock at the selling site; do not invent stock by changing a price.", href: "/retail/stock" },
  { label: "Payments and exchange rates", detail: "Choose accepted tenders, configure merchant details and set any required ZiG rate.", href: "/milling/settings/shop/payments" },
  { label: "Tills and devices", detail: "Create a till at the selling site and pair the device that will take sales.", href: "/retail/manage/tills" },
  { label: "Staff and PINs", detail: "Give cashiers the appropriate access and PINs.", href: "/retail/manage/people" },
  { label: "Till rules", detail: "Configure shifts, cash handling, discounts and offline limits.", href: "/milling/settings/shop/till-rules" },
  { label: "Receipts", detail: "Set receipt details and print a test receipt.", href: "/milling/settings/shop/receipts" },
  { label: "Fiscal device", detail: "Configure and connect the fiscal device where required; check its status before fiscal sales.", href: "/milling/settings/shop/fiscal" },
  { label: "Posting to the books", detail: "Set up the accounts and payment mappings and resolve the posting checks.", href: "/milling/settings/shop/posting" },
  { label: "Open the selling shift", detail: "Once setup is complete, open a shift on the paired till to start selling.", href: "/retail/shifts" },
] as const;
