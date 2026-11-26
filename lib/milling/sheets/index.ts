import type { SheetKind } from "@/lib/workspace/sheet-kind";

import { CUSTOMER_SHEETS } from "./customers";
import { DESPATCH_SHEETS } from "./despatch";
import { EXCEPTION_SHEETS } from "./exceptions";
import { FORM_SHEETS } from "./forms";
import { TILL_SHEETS } from "./till";
import { GO_LIVE_SHEETS } from "./go-live";
import { GROUP_SHEETS } from "./groups";
import { MACHINE_SHEETS } from "./machines";
import { ORDER_SHEETS } from "./orders";
import { PRODUCTION_RUN_SHEETS } from "./production-runs";
import { PLAN_SHEETS } from "./plans";
import { PRODUCTION_SHEETS } from "./production";
import { QC_SHEETS } from "./qc";
import { RUN_SHEETS } from "./run";
import { SELLER_SHEETS } from "./sellers";
import { SETTINGS_SHEETS } from "./settings";
import { STOCK_SHEETS } from "./stock";
import { TRIP_SHEETS } from "./trip";

/**
 * The mill's sheets, by the `?sheet=` key that opens them. Every key starts
 * `mill-`, so core's own sheet host leaves them to `MillSheetHost`.
 */
export const MILL_SHEETS: Readonly<Record<string, SheetKind>> = {
  ...EXCEPTION_SHEETS,
  ...PRODUCTION_SHEETS,
  ...DESPATCH_SHEETS,
  ...PLAN_SHEETS,
  ...ORDER_SHEETS,
  ...PRODUCTION_RUN_SHEETS,
  ...CUSTOMER_SHEETS,
  ...MACHINE_SHEETS,
  ...TRIP_SHEETS,
  ...SELLER_SHEETS,
  ...STOCK_SHEETS,
  ...SETTINGS_SHEETS,
  ...GROUP_SHEETS,
  ...GO_LIVE_SHEETS,
  ...FORM_SHEETS,
  ...TILL_SHEETS,
  ...QC_SHEETS,
  ...RUN_SHEETS,
};
