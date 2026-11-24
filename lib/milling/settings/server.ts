import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

import { writePlatformAuditEvent } from "@/lib/audit/platform";

import {
  GENERAL_SETTINGS_FIELDS,
  getSettingsResource,
  type SettingsField,
  type SettingsResource,
  type SettingsResourceKey,
} from "./fields";

type SettingsDb = PrismaClient | Prisma.TransactionClient;

export class MillSettingsError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type SettingsRow = { id: string } & Record<string, unknown>;
export type SettingsOptions = Record<string, Array<{ value: string; label: string }>>;
export interface SettingsList {
  rows: SettingsRow[];
  /** Choices that come from the workspace, by field key. */
  options: SettingsOptions;
}

/** A field's validator. Empty optional values arrive as null. */
function fieldSchema(field: SettingsField): z.ZodTypeAny {
  switch (field.type) {
    case "number": {
      let schema = z.coerce.number({ error: `${field.label} must be a number.` });
      if (field.min !== undefined) schema = schema.min(field.min, `${field.label} is at least ${field.min}.`);
      if (field.max !== undefined) schema = schema.max(field.max, `${field.label} is at most ${field.max}.`);
      return field.required
        ? z.preprocess((value) => typeof value === "string" && !value.trim() ? undefined : value, schema)
        : z.preprocess((value) => (typeof value === "string" && !value.trim() ? null : value), schema.nullable());
    }
    case "boolean":
      return z.boolean();
    case "list":
      return z.preprocess(
        (value) =>
          typeof value === "string"
            ? value.split(",").map((part) => part.trim()).filter(Boolean)
            : value,
        z.array(z.string().trim().min(1).max(50)).max(50),
      );
    case "select": {
      const base = field.options?.length
        ? z.enum(field.options.map((option) => option.value) as [string, ...string[]])
        : z.string().trim().min(1, `${field.label} is needed.`);
      return field.required ? base : z.preprocess((value) => (value === "" ? null : value), base.nullable());
    }
    case "text": {
      const base = z.string().trim().max(200);
      if (field.required) return base.min(1, `${field.label} is needed.`);
      return z.preprocess((value) => (value === "" ? null : value), base.nullable());
    }
  }
}

/** What the API accepts for a resource: editable fields only; on create, the create-only ones too. */
export function settingsSchema(fields: readonly SettingsField[], mode: "create" | "update") {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    if (field.readOnly) continue;
    if (field.createOnly && mode === "update") continue;
    const schema = fieldSchema(field);
    shape[field.key] = mode === "create" && field.required ? schema : schema.optional();
  }
  return z.object(shape).strict();
}

export function parseSettings(fields: readonly SettingsField[], mode: "create" | "update", body: unknown) {
  const parsed = settingsSchema(fields, mode).safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new MillSettingsError(issue?.message ?? "Those values were not accepted.");
  }
  const data = parsed.data as Record<string, unknown>;
  if (typeof data.code === "string") data.code = data.code.toUpperCase().replace(/\s+/g, "-");
  return data;
}

function resourceOrThrow(key: string): SettingsResource {
  const resource = getSettingsResource(key);
  if (!resource) throw new MillSettingsError("No such setting.", 404);
  return resource;
}

const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

export async function listSettings(db: SettingsDb, companyId: string, key: string): Promise<SettingsList> {
  const resource = resourceOrThrow(key);
  const where = { companyId };
  switch (resource.key) {
    case "stages":
      return { rows: await db.millingProcessStage.findMany({ where, orderBy: [{ sequence: "asc" }, { code: "asc" }] }), options: {} };
    case "qc-specs":
      return {
        rows: (await db.millingQcSpec.findMany({ where, orderBy: [{ point: "asc" }, { code: "asc" }] })).map((row) => ({
          ...row,
          minValue: num(row.minValue),
          maxValue: num(row.maxValue),
        })),
        options: {},
      };
    case "destinations":
      return {
        rows: (await db.millingDestination.findMany({ where, orderBy: { name: "asc" } })).map((row) => ({
          ...row,
          distanceKm: num(row.distanceKm),
        })),
        options: {},
      };
    case "duties":
      return { rows: await db.millingShiftDuty.findMany({ where, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }), options: {} };
    case "locations": {
      const profiles = await db.millingLocationProfile.findMany({ where });
      const locations = await db.stockLocation.findMany({
        where: { site: { companyId, isActive: true }, isActive: true },
        select: { id: true, code: true, name: true, sortOrder: true, site: { select: { name: true } } },
      });
      return {
        rows: locations
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((location) => {
            const profile = profiles.find((row) => row.stockLocationId === location.id);
            return { id: profile?.id ?? location.id, location: `${location.site.name} · ${location.code} · ${location.name}`, kind: profile?.kind ?? "STORE", capacityKg: num(profile?.capacityKg) };
          }),
        options: { siteId: (await db.site.findMany({ where: { companyId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } })).map((site) => ({ value: site.id, label: site.name })) },
      };
    }
    case "vehicles": {
      const profiles = await db.millingVehicleProfile.findMany({ where });
      const [vehicles, drivers] = await Promise.all([
        db.equipment.findMany({
          where: { category: "VEHICLE", isActive: true, site: { companyId, isActive: true } },
          select: { id: true, equipmentCode: true, name: true, registrationNumber: true },
        }),
        db.user.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      ]);
      return {
        rows: vehicles.map((vehicle) => {
          const profile = profiles.find((row) => row.equipmentId === vehicle.id);
          return {
            id: profile?.id ?? vehicle.id,
            vehicle: `${vehicle.equipmentCode} · ${vehicle.name}`,
            registrationNumber: profile?.registrationNumber ?? vehicle.registrationNumber,
            capacityKg: num(profile?.capacityKg),
            driverUserId: profile?.driverUserId ?? null,
          };
        }).sort((a, b) => a.vehicle.localeCompare(b.vehicle)),
        options: { driverUserId: drivers.map((driver) => ({ value: driver.id, label: driver.name })) },
      };
    }
    case "recipes": {
      const recipes = await db.millingPackRecipe.findMany({ where });
      const products = await db.product.findMany({
        where: { companyId },
        select: { id: true, code: true, name: true, unit: true, isActive: true, archivedAt: true },
        orderBy: { name: "asc" },
      });
      const byId = new Map(products.map((product) => [product.id, product]));
      return {
        rows: recipes
          .filter((row) => byId.has(row.packedProductId))
          .map((row) => ({
            id: row.id,
            packedProductId: row.packedProductId,
            bulkProductId: row.bulkProductId,
            packed: byId.get(row.packedProductId)!.name,
            bulk: byId.get(row.bulkProductId)?.name ?? "(product removed)",
            kgPerBag: num(row.kgPerBag),
            bagProductId: row.bagProductId,
            threadPerBag: num(row.threadPerBag),
            isActive: row.isActive,
          }))
          .sort((a, b) => String(a.packed).localeCompare(String(b.packed))),
        options: {
          packedProductId: products.filter((product) => product.isActive && !product.archivedAt && product.unit === "BAG").map((product) => ({ value: product.id, label: `${product.code} · ${product.name}` })),
          bulkProductId: products.filter((product) => product.isActive && !product.archivedAt && product.unit === "KILOGRAM").map((product) => ({ value: product.id, label: `${product.code} · ${product.name}` })),
          bagProductId: products
            .filter((product) => product.isActive && !product.archivedAt && product.unit === "EACH")
            .map((product) => ({ value: product.id, label: `${product.code} · ${product.name}` })),
        },
      };
    }
  }
}

/** A choice from the workspace must be one the list offered. */
async function checkOptions(db: SettingsDb, companyId: string, key: SettingsResourceKey, data: Record<string, unknown>) {
  const { options } = await listSettings(db, companyId, key);
  for (const [field, choices] of Object.entries(options)) {
    const value = data[field];
    if (value === undefined || value === null) continue;
    if (!choices.some((choice) => choice.value === value)) throw new MillSettingsError("That choice is not in this workspace.");
  }
}

async function audit(
  db: SettingsDb,
  args: { companyId: string; actorId: string; key: string; id: string; action: "added" | "changed"; before?: unknown; after: unknown },
) {
  await writePlatformAuditEvent(
    {
      companyId: args.companyId,
      actorId: args.actorId,
      eventType: `milling.settings.${args.action}`,
      entityType: `milling.${args.key}`,
      entityId: args.id,
      payload: { before: args.before ?? null, after: args.after },
    },
    db,
  );
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

export async function createSetting(
  db: PrismaClient,
  args: { companyId: string; actorId: string; key: string; body: unknown },
): Promise<SettingsRow> {
  const resource = resourceOrThrow(args.key);
  if (!resource.canCreate) throw new MillSettingsError(`${resource.label} are added in Maintenance; edit their delivery details here.`);
  const data = { ...parseSettings(resource.fields, "create", args.body), companyId: args.companyId };
  try {
    return await db.$transaction(async (tx) => {
      await checkOptions(tx, args.companyId, resource.key, data);
      if (resource.key === "qc-specs") validateQcRule(data);
      if (resource.key === "recipes") await validateRecipe(tx, args.companyId, data);
      const row = await createRow(tx, resource.key, data);
      await audit(tx, { companyId: args.companyId, actorId: args.actorId, key: resource.key, id: row.id, action: "added", after: data });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new MillSettingsError("That code or packed-product recipe is already used.");
    throw error;
  }
}

/** Numeric checks need at least one inclusive passing limit; pass/fail checks have no numeric limits. */
function validateQcRule(data: Record<string, unknown>) {
  if (data.resultType === "PASS_FAIL") {
    if (!String(data.guidance ?? "").trim()) throw new MillSettingsError("Describe what a pass looks like for a pass/fail check.");
    data.minValue = null;
    data.maxValue = null;
    data.unit = null;
    return;
  }
  if (data.resultType !== "NUMERIC") throw new MillSettingsError("Choose Pass or fail or Numeric reading.");
  if (data.minValue == null && data.maxValue == null) throw new MillSettingsError("A numeric check needs a minimum or maximum passing reading.");
  if (data.minValue != null && data.maxValue != null && Number(data.minValue) > Number(data.maxValue)) {
    throw new MillSettingsError("The minimum passing reading cannot be greater than the maximum.");
  }
}

async function validateRecipe(db: SettingsDb, companyId: string, data: Record<string, unknown>) {
  const packed = await db.product.findFirst({ where: { id: String(data.packedProductId), companyId, isActive: true, archivedAt: null, unit: "BAG" } });
  const bulk = await db.product.findFirst({ where: { id: String(data.bulkProductId), companyId, isActive: true, archivedAt: null, unit: "KILOGRAM" } });
  if (!packed || !bulk) throw new MillSettingsError("Choose your active packed product in bags and bulk product in kilograms.");
  if (data.bagProductId) {
    const bag = await db.product.findFirst({ where: { id: String(data.bagProductId), companyId, isActive: true, archivedAt: null, unit: "EACH" } });
    if (!bag) throw new MillSettingsError("Choose an active empty-bag product from this workspace.");
  }
  if (Number(data.threadPerBag) > 0 && !await db.product.findFirst({ where: { companyId, code: "THREAD", isActive: true, archivedAt: null } })) {
    throw new MillSettingsError("Add an active sewing-thread product with code THREAD before setting thread per bag.");
  }
}

async function createRow(db: SettingsDb, key: SettingsResourceKey, data: Record<string, unknown>): Promise<SettingsRow> {
  // The schema built from the fields has already shaped `data` for its table.
  const anyData = data as never;
  switch (key) {
    case "locations": {
      const site = await db.site.findFirst({ where: { id: String(data.siteId), companyId: String(data.companyId), isActive: true }, select: { id: true } });
      if (!site) throw new MillSettingsError("Choose an active site in this workspace.");
      const location = await db.stockLocation.create({ data: { siteId: site.id, code: String(data.code), name: String(data.name) } });
      return db.millingLocationProfile.create({ data: { companyId: String(data.companyId), stockLocationId: location.id, kind: String(data.kind), capacityKg: data.capacityKg as number | null | undefined } });
    }
    case "recipes":
      return db.millingPackRecipe.create({ data: anyData });
    case "stages":
      return db.millingProcessStage.create({ data: anyData });
    case "qc-specs":
      return db.millingQcSpec.create({ data: anyData });
    case "destinations":
      return db.millingDestination.create({ data: anyData });
    case "duties":
      return db.millingShiftDuty.create({ data: anyData });
    default:
      throw new MillSettingsError("These are not added here.");
  }
}

/** What changing a check's rule means: a new version, so earlier results keep the rule they were judged by. */
const QC_RULE_FIELDS = ["method", "resultType", "unit", "minValue", "maxValue", "required"];

export async function updateSetting(
  db: PrismaClient,
  args: { companyId: string; actorId: string; key: string; id: string; body: unknown },
): Promise<SettingsRow> {
  try {
    return await db.$transaction((tx) => updateSettingInTransaction(tx, args));
  } catch (error) {
    if (isUniqueViolation(error)) throw new MillSettingsError("That code or packed-product recipe is already used.");
    throw error;
  }
}

async function updateSettingInTransaction(
  db: SettingsDb,
  args: { companyId: string; actorId: string; key: string; id: string; body: unknown },
): Promise<SettingsRow> {
  const resource = resourceOrThrow(args.key);
  const data = parseSettings(resource.fields, "update", args.body);
  const where = { id: args.id, companyId: args.companyId };
  const anyData = data as never;

  const before = await findRow(db, resource.key, where);
  if (!before) throw new MillSettingsError("Not found.", 404);
  // An old recipe can be switched off even if a referenced product was archived.
  // New/changed references must still come from the active workspace choices.
  const choicesToCheck = resource.key === "recipes"
    ? Object.fromEntries(Object.entries(data).filter(([key, value]) => String(value ?? "") !== String((before as Record<string, unknown>)[key] ?? "")))
    : data;
  await checkOptions(db, args.companyId, resource.key, choicesToCheck);
  if (resource.key === "qc-specs") {
    const effective: Record<string, unknown> = { ...before, ...data };
    validateQcRule(effective);
    // Drop obsolete numeric rules when switching to pass/fail, including on partial API updates.
    if (effective.resultType === "PASS_FAIL") Object.assign(data, { unit: null, minValue: null, maxValue: null });
  }
  if (resource.key === "recipes" && (data.isActive ?? (before as { isActive: boolean }).isActive) !== false) await validateRecipe(db, args.companyId, { ...before, ...data });

  let after: SettingsRow;
  switch (resource.key) {
    case "stages":
      after = await db.millingProcessStage.update({ where: { id: args.id }, data: anyData });
      break;
    case "qc-specs": {
      const ruleChanged = QC_RULE_FIELDS.some(
        (field) => field in data && String(data[field] ?? "") !== String((before as Record<string, unknown>)[field] ?? ""),
      );
      after = await db.millingQcSpec.update({
        where: { id: args.id },
        data: { ...(data as object), ...(ruleChanged ? { version: { increment: 1 } } : {}) },
      });
      break;
    }
    case "destinations":
      after = await db.millingDestination.update({ where: { id: args.id }, data: anyData });
      break;
    case "duties":
      after = await db.millingShiftDuty.update({ where: { id: args.id }, data: anyData });
      break;
    case "locations":
      after = await db.millingLocationProfile.upsert({
        where: { stockLocationId: (before as { stockLocationId: string }).stockLocationId },
        create: { companyId: args.companyId, stockLocationId: (before as { stockLocationId: string }).stockLocationId, kind: "STORE", ...(data as object) },
        update: anyData,
      });
      break;
    case "vehicles":
      after = await db.millingVehicleProfile.upsert({
        where: { equipmentId: (before as { equipmentId: string }).equipmentId },
        create: { companyId: args.companyId, equipmentId: (before as { equipmentId: string }).equipmentId, ...(data as object) },
        update: anyData,
      });
      break;
    case "recipes":
      after = await db.millingPackRecipe.update({ where: { id: args.id }, data: anyData });
      break;
  }
  await audit(db, { companyId: args.companyId, actorId: args.actorId, key: resource.key, id: after.id, action: "changed", before, after: data });
  return after;
}

async function findRow(db: SettingsDb, key: SettingsResourceKey, where: { id: string; companyId: string }) {
  switch (key) {
    case "stages":
      return db.millingProcessStage.findFirst({ where });
    case "qc-specs":
      return db.millingQcSpec.findFirst({ where });
    case "destinations":
      return db.millingDestination.findFirst({ where });
    case "duties":
      return db.millingShiftDuty.findFirst({ where });
    case "locations": {
      const profile = await db.millingLocationProfile.findFirst({ where });
      const location = await db.stockLocation.findFirst({ where: { id: profile?.stockLocationId ?? where.id, site: { companyId: where.companyId, isActive: true }, isActive: true } });
      return location ? profile ?? { id: location.id, stockLocationId: location.id } : null;
    }
    case "vehicles": {
      const profile = await db.millingVehicleProfile.findFirst({ where });
      const vehicle = await db.equipment.findFirst({ where: { id: profile?.equipmentId ?? where.id, site: { companyId: where.companyId, isActive: true }, category: "VEHICLE", isActive: true } });
      return vehicle ? profile ?? { id: vehicle.id, equipmentId: vehicle.id } : null;
    }
    case "recipes":
      return db.millingPackRecipe.findFirst({ where });
  }
}

/** The one-row settings, created with its defaults the first time it is read. */
export async function getGeneralSettings(db: PrismaClient, companyId: string) {
  const row = await db.millingSettings.upsert({ where: { companyId }, update: {}, create: { companyId } });
  return {
    reconciliationTolerancePct: Number(row.reconciliationTolerancePct),
    defaultIntakeBagKg: Number(row.defaultIntakeBagKg),
    shiftHours: Number(row.shiftHours),
    shiftCrewSize: row.shiftCrewSize,
  };
}

export async function updateGeneralSettings(
  db: PrismaClient,
  args: { companyId: string; actorId: string; body: unknown },
) {
  const data = parseSettings(GENERAL_SETTINGS_FIELDS, "update", args.body);
  const before = await getGeneralSettings(db, args.companyId);
  await db.millingSettings.update({ where: { companyId: args.companyId }, data: { ...(data as object), updatedById: args.actorId } });
  await audit(db, { companyId: args.companyId, actorId: args.actorId, key: "general", id: args.companyId, action: "changed", before, after: data });
  return getGeneralSettings(db, args.companyId);
}
