import type { ProductKind, UnitOfMeasure } from "@prisma/client";

/**
 * The mill a new milling workspace starts with: one production site, its
 * stock locations, its process equipment and fleet, and its products.
 *
 * This is the client's own description of the plant (one site, one shift,
 * the route from intake through pre-cleaning, destoning, conditioning into
 * Bin 1, degermination, aspiration, roller mills and sift boxes to the meal
 * bin and packing). Everything here is ordinary tenant data: the seed creates
 * what is missing and never changes what exists, so the mill edits all of it
 * afterwards in its own settings.
 */

export interface MillSite {
  code: string;
  name: string;
  location: string;
}

export type MillLocationKind = "STORE" | "BIN" | "SILO" | "PROCESS" | "DOCK" | "VEHICLE";

export interface MillLocation {
  code: string;
  name: string;
  kind: MillLocationKind;
}

export interface MillEquipment {
  code: string;
  name: string;
  category: string;
  /** A `MillLocation` code: where the machine stands. */
  location: string;
}

export interface MillProduct {
  code: string;
  name: string;
  kind: ProductKind;
  unit: UnitOfMeasure;
  unitLabel?: string;
  /** Net kg in one unit; every BAG product has one, so tonnage is never guessed. */
  netWeightKg?: number;
  category: string;
}

export const MILL_SITE: MillSite = { code: "NORTON", name: "Norton mill", location: "Norton" };

export const MILL_LOCATIONS: readonly MillLocation[] = [
  { code: "RCV", kind: "DOCK", name: "Maize receiving" },
  { code: "MZ-STORE", kind: "STORE", name: "Maize store" },
  { code: "BIN-1", kind: "BIN", name: "Bin 1 (conditioning)" },
  { code: "PLANT", kind: "PROCESS", name: "Plant floor" },
  { code: "MEAL-BIN", kind: "BIN", name: "Meal storage bin" },
  { code: "BRAN", kind: "STORE", name: "Bran (bulk)" },
  { code: "GEM", kind: "STORE", name: "Gem (bulk)" },
  { code: "POWDER", kind: "STORE", name: "Powder (bulk)" },
  { code: "FG", kind: "STORE", name: "Finished goods" },
  { code: "PKG", kind: "STORE", name: "Packaging store" },
  { code: "YARD", kind: "STORE", name: "Yard" },
];

/**
 * The plant in process order, then the fleet. Equipment categories are the
 * ones `extensions/milling` adds to maintenance; VEHICLE is core's.
 */
export const MILL_EQUIPMENT: readonly MillEquipment[] = [
  { code: "AUG-INTAKE", name: "Intake augers", category: "AUGER", location: "RCV" },
  { code: "PC-1", name: "Pre-cleaner 1", category: "PRE_CLEANER", location: "PLANT" },
  { code: "PC-2", name: "Pre-cleaner 2 (destoner)", category: "DESTONER", location: "PLANT" },
  { code: "COND", name: "Dumping and conditioning", category: "CONDITIONING", location: "PLANT" },
  { code: "BIN-1", name: "Bin 1", category: "BIN", location: "BIN-1" },
  { code: "AUG-DEG", name: "Augers to degermination", category: "AUGER", location: "PLANT" },
  { code: "DEG-1", name: "Degerminator 1", category: "DEGERMINATOR", location: "PLANT" },
  { code: "DEG-2", name: "Degerminator 2", category: "DEGERMINATOR", location: "PLANT" },
  { code: "AUG-UPRIGHT", name: "Upright auger", category: "AUGER", location: "PLANT" },
  { code: "ASP", name: "Aspiration system", category: "ASPIRATOR", location: "PLANT" },
  { code: "ELEV", name: "Elevators", category: "ELEVATOR", location: "PLANT" },
  { code: "PNEU", name: "Pneumatic conveying", category: "PNEUMATIC_CONVEYOR", location: "PLANT" },
  { code: "AIRLOCK", name: "Airlocks", category: "AIRLOCK", location: "PLANT" },
  { code: "RM", name: "Roller mills", category: "ROLLER_MILL", location: "PLANT" },
  { code: "SIFT", name: "Sift boxes", category: "SIFT_BOX", location: "PLANT" },
  { code: "AUG-MEAL", name: "Meal auger", category: "AUGER", location: "PLANT" },
  { code: "MEAL-BIN", name: "Meal storage bin", category: "BIN", location: "MEAL-BIN" },
  { code: "SEW", name: "Bag sewing", category: "SEWING_MACHINE", location: "FG" },
  { code: "MOIST", name: "Grain moisture meter", category: "INSTRUMENT", location: "RCV" },
  { code: "UD-1", name: "UD truck 1", category: "VEHICLE", location: "YARD" },
  { code: "UD-2", name: "UD truck 2", category: "VEHICLE", location: "YARD" },
  { code: "HYU-1", name: "Hyundai", category: "VEHICLE", location: "YARD" },
];

export const MILL_PRODUCTS: readonly MillProduct[] = [
  { code: "MAIZE", name: "White maize (grain)", kind: "MATERIAL", unit: "KILOGRAM", category: "Maize" },

  { code: "MEAL-BULK", name: "Mealie meal (bulk)", kind: "MATERIAL", unit: "KILOGRAM", category: "Bulk product" },
  { code: "BRAN-BULK", name: "Bran (bulk)", kind: "MATERIAL", unit: "KILOGRAM", category: "Bulk product" },
  { code: "GEM-BULK", name: "Gem (bulk)", kind: "MATERIAL", unit: "KILOGRAM", category: "Bulk product" },
  { code: "POWDER-BULK", name: "Powder (bulk)", kind: "MATERIAL", unit: "KILOGRAM", category: "Bulk product" },

  { code: "MEAL-5", name: "Mealie meal 5 kg", kind: "GOODS", unit: "BAG", netWeightKg: 5, category: "Packed" },
  { code: "MEAL-10", name: "Mealie meal 10 kg", kind: "GOODS", unit: "BAG", netWeightKg: 10, category: "Packed" },
  { code: "BRAN-25", name: "Bran 25 kg", kind: "GOODS", unit: "BAG", netWeightKg: 25, category: "Packed" },
  { code: "GEM-40", name: "Gem 40 kg", kind: "GOODS", unit: "BAG", netWeightKg: 40, category: "Packed" },
  { code: "POWDER-50", name: "Powder 50 kg", kind: "GOODS", unit: "BAG", netWeightKg: 50, category: "Packed" },

  { code: "BAG-5", name: "Empty bag, 5 kg", kind: "MATERIAL", unit: "EACH", category: "Packaging" },
  { code: "BAG-10", name: "Empty bag, 10 kg", kind: "MATERIAL", unit: "EACH", category: "Packaging" },
  { code: "BAG-25", name: "Empty bag, 25 kg", kind: "MATERIAL", unit: "EACH", category: "Packaging" },
  { code: "BAG-40", name: "Empty bag, 40 kg", kind: "MATERIAL", unit: "EACH", category: "Packaging" },
  { code: "BAG-50", name: "Empty bag, 50 kg", kind: "MATERIAL", unit: "EACH", category: "Packaging" },
  { code: "THREAD", name: "Sewing thread", kind: "MATERIAL", unit: "OTHER", unitLabel: "cone", category: "Packaging" },
];

export interface MillStage {
  code: string;
  name: string;
  required: boolean;
  capturesQuantities: boolean;
  /** `MILL_EQUIPMENT` codes that do the stage's work. */
  equipment: string[];
}

/** The client's route, intake to packing (plan v2, 3.2). */
export const MILL_STAGES: readonly MillStage[] = [
  { code: "INTAKE", name: "Intake", required: true, capturesQuantities: true, equipment: ["AUG-INTAKE"] },
  { code: "PRECLEAN", name: "Pre-cleaning", required: true, capturesQuantities: true, equipment: ["PC-1"] },
  { code: "DESTONE", name: "Destoning", required: true, capturesQuantities: true, equipment: ["PC-2"] },
  { code: "CONDITION", name: "Conditioning", required: true, capturesQuantities: true, equipment: ["COND", "BIN-1"] },
  { code: "DEGERM", name: "Degermination", required: true, capturesQuantities: true, equipment: ["AUG-DEG", "DEG-1", "DEG-2"] },
  { code: "ASPIRATE", name: "Aspiration", required: false, capturesQuantities: true, equipment: ["AUG-UPRIGHT", "ASP"] },
  { code: "CONVEY", name: "Conveying to milling", required: false, capturesQuantities: false, equipment: ["ELEV", "PNEU", "AIRLOCK"] },
  { code: "MILL", name: "Milling and sifting", required: true, capturesQuantities: true, equipment: ["RM", "SIFT"] },
  { code: "STORE", name: "Meal storage", required: true, capturesQuantities: true, equipment: ["AUG-MEAL", "MEAL-BIN"] },
  { code: "PACK", name: "Inspection and packing", required: true, capturesQuantities: true, equipment: ["SEW"] },
];

export interface MillQcSpec {
  point: "INCOMING_MAIZE" | "FINISHED_PRODUCT";
  code: string;
  name: string;
  method: "VISUAL" | "INSTRUMENT";
  resultType: "NUMERIC" | "PASS_FAIL";
  unit?: string;
  maxValue?: number;
  guidance: string;
}

/** The checks the client makes: visual, plus the moisture meter (plan v2, 3.4). */
export const MILL_QC_SPECS: readonly MillQcSpec[] = [
  { point: "INCOMING_MAIZE", code: "MOISTURE", name: "Moisture", method: "INSTRUMENT", resultType: "NUMERIC", unit: "%", maxValue: 12.5, guidance: "Moisture meter reading. Over the limit: hold the lot." },
  { point: "INCOMING_MAIZE", code: "VARIETY", name: "Variety and colour", method: "VISUAL", resultType: "PASS_FAIL", guidance: "Predominantly white. Note any purple or yellow grain." },
  { point: "INCOMING_MAIZE", code: "INSECTS", name: "Insect infestation", method: "VISUAL", resultType: "PASS_FAIL", guidance: "No live insects. Live insects: hold the lot." },
  { point: "INCOMING_MAIZE", code: "FOREIGN", name: "Foreign matter", method: "VISUAL", resultType: "PASS_FAIL", guidance: "No stones, sticks, glass or other grain beyond a trace." },
  { point: "FINISHED_PRODUCT", code: "COLOUR", name: "Colour", method: "VISUAL", resultType: "PASS_FAIL", guidance: "Uniform natural colour." },
  { point: "FINISHED_PRODUCT", code: "APPEARANCE", name: "Appearance", method: "VISUAL", resultType: "PASS_FAIL", guidance: "No discoloration or lumps." },
  { point: "FINISHED_PRODUCT", code: "FOREIGN", name: "Foreign matter", method: "VISUAL", resultType: "PASS_FAIL", guidance: "None visible." },
  { point: "FINISHED_PRODUCT", code: "GRANULATION", name: "Granulation", method: "VISUAL", resultType: "PASS_FAIL", guidance: "Even particle size; no excess fines or coarse." },
];

export const MILL_DESTINATIONS: readonly { code: string; name: string }[] = [
  { code: "SHAMVA", name: "Shamva" },
  { code: "MAZOWE", name: "Mazowe" },
  { code: "NYABIRA", name: "Nyabira" },
  { code: "HATCLIFFE", name: "Hatcliffe" },
];

/** A starting list for the crew of seven; the client confirms their duties (DECISIONS.md, D6). */
export const MILL_SHIFT_DUTIES: readonly { code: string; name: string }[] = [
  { code: "SUPERVISOR", name: "Shift supervisor" },
  { code: "INTAKE", name: "Intake and cleaning" },
  { code: "CONDITION", name: "Conditioning" },
  { code: "DEGERM", name: "Degermination" },
  { code: "MILL", name: "Roller mills and sifting" },
  { code: "PACK", name: "Packing" },
  { code: "SEW", name: "Sewing and stacking" },
];

export interface MillPackRecipe {
  packed: string;
  bulk: string;
  bag: string;
  /** Thread per bag is to be confirmed by the client: unset until then. */
}

/** Each packed product: from its bulk product, in its own bag. */
export const MILL_PACK_RECIPES: readonly MillPackRecipe[] = [
  { packed: "MEAL-5", bulk: "MEAL-BULK", bag: "BAG-5" },
  { packed: "MEAL-10", bulk: "MEAL-BULK", bag: "BAG-10" },
  { packed: "BRAN-25", bulk: "BRAN-BULK", bag: "BAG-25" },
  { packed: "GEM-40", bulk: "GEM-BULK", bag: "BAG-40" },
  { packed: "POWDER-50", bulk: "POWDER-BULK", bag: "BAG-50" },
];
