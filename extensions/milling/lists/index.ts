import type { ReportDefinition } from "@/lib/reports/types";

import { EXCEPTIONS_LIST } from "./exceptions";
import { INTAKE_LIST } from "./intake";
import { TRIPS_LIST } from "./trips";

/** The mill's working lists, drawn by core's ListFrame like every other list in the product. Loaders: `./loaders.ts`. */
export const MILLING_LISTS: ReportDefinition[] = [INTAKE_LIST, EXCEPTIONS_LIST, TRIPS_LIST];
