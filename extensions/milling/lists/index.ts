import type { ReportDefinition } from "@/lib/reports/types";

import { DESPATCHES_LIST, ORDERS_LIST, ROUTES_LIST } from "./despatch";
import { EXCEPTIONS_LIST } from "./exceptions";
import { INTAKE_LIST } from "./intake";
import { PLANS_LIST, SHIFTS_LIST } from "./people";
import { PACKING_LIST, RUNS_LIST, TESTS_LIST } from "./production";
import { TRIPS_LIST } from "./trips";

/** The mill's working lists, drawn by core's ListFrame like every other list in the product. Loaders: `./loaders.ts`. */
export const MILLING_LISTS: ReportDefinition[] = [INTAKE_LIST, PLANS_LIST, SHIFTS_LIST, RUNS_LIST, PACKING_LIST, TESTS_LIST, DESPATCHES_LIST, TRIPS_LIST, ROUTES_LIST, ORDERS_LIST, EXCEPTIONS_LIST];
