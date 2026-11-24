/**
 * The mill's settings, described once. The same description draws the table
 * and the form (`components/milling/settings-resource.tsx`) and validates what
 * the API accepts (`./server.ts`), so a field cannot be editable on screen and
 * refused on save, or the reverse.
 *
 * Plain data: imported by pages and route handlers alike.
 */

export type SettingsFieldType = "text" | "number" | "boolean" | "select" | "list";

export interface SettingsField {
  key: string;
  label: string;
  type: SettingsFieldType;
  required?: boolean;
  /** Fixed choices; a field whose choices come from the workspace gets them from the API (`options`). */
  options?: ReadonlyArray<{ value: string; label: string }>;
  min?: number;
  max?: number;
  /** A unit shown after a number, e.g. "kg". */
  unit?: string;
  help?: string;
  /** Shown in the table, never edited here (it belongs to a core record). */
  readOnly?: boolean;
  /** Set when the row is added and fixed after: codes other records refer to. */
  createOnly?: boolean;
  /** Left out of the table, kept in the form. */
  formOnly?: boolean;
  /** Only shown for numeric quality checks. */
  numericOnly?: boolean;
}

export type SettingsResourceKey =
  | "stages"
  | "qc-specs"
  | "locations"
  | "vehicles"
  | "destinations"
  | "duties"
  | "recipes";

export interface SettingsResource {
  key: SettingsResourceKey;
  /** Tab label. */
  label: string;
  /** One row, for buttons and headings: "Add a destination". */
  singular: string;
  description: string;
  /** Profiles hang off core records (a location, a vehicle, a product) and are only edited here. */
  canCreate: boolean;
  fields: readonly SettingsField[];
}

const yesNo = (key: string, label: string, help?: string): SettingsField => ({ key, label, type: "boolean", help });

export const LOCATION_KINDS = [
  { value: "STORE", label: "Store" },
  { value: "BIN", label: "Bin" },
  { value: "SILO", label: "Silo" },
  { value: "PROCESS", label: "Process (in the line)" },
  { value: "DOCK", label: "Receiving or loading" },
  { value: "VEHICLE", label: "Vehicle" },
  { value: "SELLERS", label: "With sellers" },
] as const;

export const QC_POINTS = [
  { value: "INCOMING_MAIZE", label: "Incoming maize" },
  { value: "FINISHED_PRODUCT", label: "Finished product" },
] as const;

export const QC_METHODS = [
  { value: "VISUAL", label: "Visual" },
  { value: "INSTRUMENT", label: "Instrument" },
] as const;

export const QC_RESULT_TYPES = [
  { value: "PASS_FAIL", label: "Pass or fail" },
  { value: "NUMERIC", label: "Reading against limits" },
] as const;

export const SETTINGS_RESOURCES: readonly SettingsResource[] = [
  {
    key: "stages",
    label: "Process route",
    singular: "stage",
    description: "The mill's steps from intake to packing, in order. A batch needs a record for every required stage.",
    canCreate: true,
    fields: [
      { key: "sequence", label: "Order", type: "number", required: true, min: 0, max: 10000 },
      { key: "code", label: "Code", type: "text", required: true, createOnly: true },
      { key: "name", label: "Stage", type: "text", required: true },
      yesNo("required", "Required", "A batch cannot complete without it."),
      yesNo("capturesQuantities", "Records quantities", "Off for pass-through stages that only record time and downtime."),
      { key: "equipmentCodes", label: "Equipment", type: "list", help: "Equipment codes, comma separated, e.g. DEG-1, DEG-2." },
      yesNo("isActive", "In use"),
    ],
  },
  {
    key: "qc-specs",
    label: "Quality checks",
    singular: "check",
    description: "What is checked on maize at intake and on product before release. A change to a check starts a new version; results keep the version they were judged against.",
    canCreate: true,
    fields: [
      { key: "point", label: "Check at", type: "select", required: true, options: QC_POINTS, createOnly: true },
      { key: "code", label: "Code", type: "text", required: true, createOnly: true },
      { key: "name", label: "Check", type: "text", required: true },
      { key: "method", label: "Method", type: "select", required: true, options: QC_METHODS },
      { key: "resultType", label: "How to record the result", type: "select", required: true, options: QC_RESULT_TYPES },
      { key: "unit", label: "Reading unit (for example %)", type: "text", numericOnly: true },
      { key: "minValue", label: "Minimum passing reading", type: "number", numericOnly: true },
      { key: "maxValue", label: "Maximum passing reading", type: "number", numericOnly: true },
      { key: "guidance", label: "What a pass looks like", type: "text", formOnly: true, help: "Required for pass/fail checks. Tell the operator exactly what to look for." },
      yesNo("required", "Required", "Not performed blocks release until someone overrides it."),
      { key: "version", label: "Version", type: "number", readOnly: true },
      yesNo("isActive", "In use"),
    ],
  },
  {
    key: "locations",
    label: "Locations and bins",
    singular: "location",
    description: "Add a stock location or bin at a site, then set its type and capacity. Existing Stores locations also appear here.",
    canCreate: true,
    fields: [
      { key: "siteId", label: "Site", type: "select", required: true, createOnly: true, formOnly: true },
      { key: "code", label: "Location code", type: "text", required: true, createOnly: true, formOnly: true },
      { key: "name", label: "Location name", type: "text", required: true, createOnly: true, formOnly: true },
      { key: "location", label: "Location", type: "text", readOnly: true },
      { key: "kind", label: "Kind", type: "select", required: true, options: LOCATION_KINDS },
      { key: "capacityKg", label: "Holds", type: "number", unit: "kg", min: 0 },
    ],
  },
  {
    key: "vehicles",
    label: "Vehicles",
    singular: "vehicle",
    description: "Vehicles added in Maintenance with category Vehicle appear automatically. Set their delivery capacity and usual driver here.",
    canCreate: false,
    fields: [
      { key: "vehicle", label: "Vehicle", type: "text", readOnly: true },
      { key: "registrationNumber", label: "Registration", type: "text" },
      { key: "capacityKg", label: "Carries up to", type: "number", unit: "kg", min: 0, help: "Loading over this is refused." },
      { key: "driverUserId", label: "Usual driver", type: "select" },
    ],
  },
  {
    key: "destinations",
    label: "Destinations",
    singular: "destination",
    description: "Where the mill delivers.",
    canCreate: true,
    fields: [
      { key: "code", label: "Code", type: "text", required: true, createOnly: true },
      { key: "name", label: "Destination", type: "text", required: true },
      { key: "distanceKm", label: "Distance", type: "number", unit: "km", min: 0 },
      yesNo("isActive", "In use"),
    ],
  },
  {
    key: "duties",
    label: "Shift duties",
    singular: "duty",
    description: "The jobs on a shift, for allocating the crew.",
    canCreate: true,
    fields: [
      { key: "sortOrder", label: "Order", type: "number", min: 0, max: 1000 },
      { key: "code", label: "Code", type: "text", required: true, createOnly: true },
      { key: "name", label: "Duty", type: "text", required: true },
      yesNo("isActive", "In use"),
    ],
  },
  {
    key: "recipes",
    label: "Pack recipes",
    singular: "recipe",
    description: "How each packed product is made: bulk product per bag, the bag, and sewing thread.",
    canCreate: true,
    fields: [
      { key: "packedProductId", label: "Packed product (bags)", type: "select", required: true, createOnly: true, formOnly: true },
      { key: "bulkProductId", label: "Bulk product (kilograms)", type: "select", required: true },
      { key: "packed", label: "Packed product", type: "text", readOnly: true },
      { key: "kgPerBag", label: "Bulk per bag", type: "number", unit: "kg", required: true, min: 0.001 },
      { key: "bagProductId", label: "Bag", type: "select" },
      { key: "threadPerBag", label: "Thread per bag", type: "number", min: 0, help: "In the THREAD product’s stock unit. Leave blank when not used." },
      yesNo("isActive", "In use"),
    ],
  },
];

export function getSettingsResource(key: string): SettingsResource | undefined {
  return SETTINGS_RESOURCES.find((resource) => resource.key === key);
}

/** The one-row settings: tolerances and the shift template. */
export const GENERAL_SETTINGS_FIELDS: readonly SettingsField[] = [
  { key: "reconciliationTolerancePct", label: "Reconciliation tolerance", type: "number", unit: "%", required: true, min: 0, max: 100, help: "A batch whose material balance is off by more raises an exception." },
  { key: "defaultIntakeBagKg", label: "Intake bag weight", type: "number", unit: "kg", required: true, min: 1, max: 200, help: "What one bag of maize is taken to weigh when intake is counted in bags." },
  { key: "shiftHours", label: "Shift length", type: "number", unit: "hours", required: true, min: 1, max: 24, help: "Overtime is worked out against this." },
  { key: "shiftCrewSize", label: "Crew on a shift", type: "number", required: true, min: 1, max: 100 },
  { key: "sellerMaxDiscount", label: "Most a seller may take off a bag", type: "number", unit: "$", required: true, min: 0, max: 100, help: "Discounts above this are refused when a seller settles." },
  { key: "sellerDiscountStep", label: "Seller discounts go in steps of", type: "number", unit: "$", required: true, min: 0.01, max: 100, help: "10c steps: 0.10." },
  { key: "extractionTargetPct", label: "Extraction target", type: "number", unit: "%", required: true, min: 1, max: 100, help: "Meal out of maize milled; the director is told when a day falls short." },
];
