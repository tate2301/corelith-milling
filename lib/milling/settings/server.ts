import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { writePlatformAuditEvent } from "@/lib/audit/platform";

import {
  GENERAL_SETTINGS_FIELDS,
  getSettingsResource,
  type SettingsField,
  type SettingsResource,
  type SettingsResourceKey,
} from "./fields";

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
      return field.required ? schema : z.preprocess((value) => (value === "" ? null : value), schema.nullable());
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
        : z.string().trim().min(1);
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

export async function listSettings(db: PrismaClient, companyId: string, key: string): Promise<SettingsList> {
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
        where: { id: { in: profiles.map((row) => row.stockLocationId) }, site: { companyId } },
        select: { id: true, code: true, name: true, sortOrder: true },
      });
      const byId = new Map(locations.map((location) => [location.id, location]));
      return {
        rows: profiles
          .filter((row) => byId.has(row.stockLocationId))
          .sort((a, b) => byId.get(a.stockLocationId)!.sortOrder - byId.get(b.stockLocationId)!.sortOrder)
          .map((row) => {
            const location = byId.get(row.stockLocationId)!;
            return { id: row.id, location: `${location.code} · ${location.name}`, kind: row.kind, capacityKg: num(row.capacityKg) };
          }),
        options: {},
      };
    }
    case "vehicles": {
      const profiles = await db.millingVehicleProfile.findMany({ where });
      const [vehicles, drivers] = await Promise.all([
        db.equipment.findMany({
          where: { id: { in: profiles.map((row) => row.equipmentId) }, site: { companyId } },
          select: { id: true, equipmentCode: true, name: true },
        }),
        db.user.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      ]);
      const byId = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
      return {
        rows: profiles
          .filter((row) => byId.has(row.equipmentId))
          .map((row) => {
            const vehicle = byId.get(row.equipmentId)!;
            return {
              id: row.id,
              vehicle: `${vehicle.equipmentCode} · ${vehicle.name}`,
              registrationNumber: row.registrationNumber,
              capacityKg: num(row.capacityKg),
              driverUserId: row.driverUserId,
            };
          })
          .sort((a, b) => String(a.vehicle).localeCompare(String(b.vehicle))),
        options: { driverUserId: drivers.map((driver) => ({ value: driver.id, label: driver.name })) },
      };
    }
    case "recipes": {
      const recipes = await db.millingPackRecipe.findMany({ where });
      const products = await db.product.findMany({
        where: { companyId },
        select: { id: true, code: true, name: true, unit: true },
        orderBy: { name: "asc" },
      });
      const byId = new Map(products.map((product) => [product.id, product]));
      return {
        rows: recipes
          .filter((row) => byId.has(row.packedProductId))
          .map((row) => ({
            id: row.id,
            packed: byId.get(row.packedProductId)!.name,
            bulk: byId.get(row.bulkProductId)?.name ?? "(product removed)",
            kgPerBag: num(row.kgPerBag),
            bagProductId: row.bagProductId,
            threadPerBag: num(row.threadPerBag),
            isActive: row.isActive,
          }))
          .sort((a, b) => String(a.packed).localeCompare(String(b.packed))),
        options: {
          bagProductId: products
            .filter((product) => product.unit === "EACH")
            .map((product) => ({ value: product.id, label: `${product.code} · ${product.name}` })),
        },
      };
    }
  }
}

/** A choice from the workspace must be one the list offered. */
async function checkOptions(db: PrismaClient, companyId: string, key: SettingsResourceKey, data: Record<string, unknown>) {
  const { options } = await listSettings(db, companyId, key);
  for (const [field, choices] of Object.entries(options)) {
    const value = data[field];
    if (value === undefined || value === null) continue;
    if (!choices.some((choice) => choice.value === value)) throw new MillSettingsError("That choice is not in this workspace.");
  }
}

async function audit(
  db: PrismaClient,
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
  if (!resource.canCreate) throw new MillSettingsError(`${resource.label} are added elsewhere; edit them here.`);
  const data = { ...parseSettings(resource.fields, "create", args.body), companyId: args.companyId };
  try {
    const row = await createRow(db, resource.key, data);
    await audit(db, { companyId: args.companyId, actorId: args.actorId, key: resource.key, id: row.id, action: "added", after: data });
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) throw new MillSettingsError("That code is already used.");
    throw error;
  }
}

async function createRow(db: PrismaClient, key: SettingsResourceKey, data: Record<string, unknown>): Promise<SettingsRow> {
  // The schema built from the fields has already shaped `data` for its table.
  const anyData = data as never;
  switch (key) {
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
  const resource = resourceOrThrow(args.key);
  const data = parseSettings(resource.fields, "update", args.body);
  await checkOptions(db, args.companyId, resource.key, data);
  const where = { id: args.id, companyId: args.companyId };
  const anyData = data as never;

  const before = await findRow(db, resource.key, where);
  if (!before) throw new MillSettingsError("Not found.", 404);

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
      after = await db.millingLocationProfile.update({ where: { id: args.id }, data: anyData });
      break;
    case "vehicles":
      after = await db.millingVehicleProfile.update({ where: { id: args.id }, data: anyData });
      break;
    case "recipes":
      after = await db.millingPackRecipe.update({ where: { id: args.id }, data: anyData });
      break;
  }
  await audit(db, { companyId: args.companyId, actorId: args.actorId, key: resource.key, id: args.id, action: "changed", before, after: data });
  return after;
}

async function findRow(db: PrismaClient, key: SettingsResourceKey, where: { id: string; companyId: string }) {
  switch (key) {
    case "stages":
      return db.millingProcessStage.findFirst({ where });
    case "qc-specs":
      return db.millingQcSpec.findFirst({ where });
    case "destinations":
      return db.millingDestination.findFirst({ where });
    case "duties":
      return db.millingShiftDuty.findFirst({ where });
    case "locations":
      return db.millingLocationProfile.findFirst({ where });
    case "vehicles":
      return db.millingVehicleProfile.findFirst({ where });
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
