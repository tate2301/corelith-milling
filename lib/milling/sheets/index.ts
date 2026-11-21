import type { SheetKind } from "@/lib/workspace/sheet-kind";

import { EXCEPTION_SHEETS } from "./exceptions";

/**
 * The mill's sheets, by the `?sheet=` key that opens them. Every key starts
 * `mill-`, so core's own sheet host leaves them to `MillSheetHost`.
 */
export const MILL_SHEETS: Readonly<Record<string, SheetKind>> = {
  ...EXCEPTION_SHEETS,
};
