import type { SheetKind } from "@/lib/workspace/sheet-kind";

import { DESPATCH_SHEETS } from "./despatch";
import { EXCEPTION_SHEETS } from "./exceptions";
import { PLAN_SHEETS } from "./plans";
import { PRODUCTION_SHEETS } from "./production";

/**
 * The mill's sheets, by the `?sheet=` key that opens them. Every key starts
 * `mill-`, so core's own sheet host leaves them to `MillSheetHost`.
 */
export const MILL_SHEETS: Readonly<Record<string, SheetKind>> = {
  ...EXCEPTION_SHEETS,
  ...PRODUCTION_SHEETS,
  ...DESPATCH_SHEETS,
  ...PLAN_SHEETS,
};
