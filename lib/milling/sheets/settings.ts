import { z } from "zod";

import { fetchJson } from "@/lib/api-client";
import { SETTINGS_RESOURCES, type SettingsField, type SettingsResource } from "@/lib/milling/settings/fields";
import type { FieldSpec, SheetKind, SheetValues } from "@/lib/workspace/sheet-kind";

type Option = { value: string; label: string };
type Listing = { rows: Array<Record<string, unknown> & { id: string }>; options: Record<string, Option[]> };

const NONE = "None";
const optionsOf = (field: SettingsField, values: SheetValues): Option[] => (field.options as Option[] | undefined) ?? ((values._options as Record<string, Option[]> | undefined) ?? {})[field.key] ?? [];

function fieldSpec(field: SettingsField): FieldSpec {
  const common = {
    id: field.key,
    l: field.unit ? `${field.label}, ${field.unit}` : field.label,
    h: field.help,
    opt: !field.required,
    readWhen: (values: SheetValues) => field.readOnly === true || (field.createOnly === true && Boolean(values._editing)),
    // A read-only value (a version, the core record's name) has nothing to show until there is a row.
    ...(field.readOnly ? { show: (values: SheetValues) => Boolean(values._editing) } : {}),
  };
  switch (field.type) {
    case "boolean":
      return { ...common, t: "toggle", opt: true, optQuiet: true };
    case "number":
      return {
        ...common,
        t: "text",
        mono: true,
        right: true,
        half: true,
        inputMode: "decimal",
        schema: z
          .string()
          .regex(/^-?\d+(\.\d+)?$/, "A number.")
          .refine((value) => field.min === undefined || Number(value) >= field.min, `At least ${field.min}.`)
          .refine((value) => field.max === undefined || Number(value) <= field.max, `At most ${field.max}.`),
      };
    case "select":
      return { ...common, t: "text", o: (values) => [...(field.required ? [] : [NONE]), ...optionsOf(field, values).map((option) => option.label)] };
    case "list":
      return { ...common, t: "text", p: "Comma separated" };
    default:
      return { ...common, t: "text", mono: field.key === "code", upper: field.key === "code" };
  }
}

function toForm(field: SettingsField, raw: unknown, values: SheetValues): unknown {
  if (field.type === "boolean") return raw === true;
  if (field.type === "list") return Array.isArray(raw) ? raw.join(", ") : "";
  if (field.type === "select") return optionsOf(field, values).find((option) => option.value === raw)?.label ?? (field.required ? "" : NONE);
  return raw === null || raw === undefined ? "" : String(raw);
}

function fromForm(field: SettingsField, value: unknown, values: SheetValues): unknown {
  if (field.type === "boolean") return value === true;
  if (field.type === "list") return String(value ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  if (field.type === "select") return value === NONE ? null : (optionsOf(field, values).find((option) => option.label === value)?.value ?? null);
  if (field.type === "number") return String(value ?? "").trim() === "" ? null : Number(value);
  return String(value ?? "").trim() || null;
}

/** Add or change one row of a mill setting, from its description in lib/milling/settings/fields.ts. */
function kind(resource: SettingsResource): SheetKind {
  return {
    title: (ctx) => (ctx.id ? `Change this ${resource.singular}` : `Add a ${resource.singular}`),
    sub: resource.description,
    cur: "US$",
    load: async (ctx) => {
      const listing = await fetchJson<Listing>(`/api/milling/settings/${resource.key}`);
      const row = ctx.id ? listing.rows.find((entry) => entry.id === ctx.id) : null;
      const base: SheetValues = { _options: listing.options, _editing: Boolean(row) };
      return { ...base, ...Object.fromEntries(resource.fields.map((field) => [field.key, toForm(field, row?.[field.key], base)])) };
    },
    sections: [{ fields: resource.fields.map(fieldSpec) }],
    note: "",
    primary: (values) => (values._editing ? "Save" : `Add ${resource.singular}`),
    done: (_result, values) => (values._editing ? "Saved" : `${resource.singular.charAt(0).toUpperCase()}${resource.singular.slice(1)} added`),
    submit: (values, ctx) => {
      const editing = Boolean(ctx.id);
      const body = Object.fromEntries(
        resource.fields.filter((field) => !field.readOnly && !(editing && field.createOnly)).map((field) => [field.key, fromForm(field, values[field.key], values)]),
      );
      return editing ? { method: "PATCH", url: `/api/milling/settings/${resource.key}/${ctx.id}`, body } : { method: "POST", url: `/api/milling/settings/${resource.key}`, body };
    },
    invalidate: [["list"], ["reports"], ["milling"]],
    requires: [["ext:milling", "settings.manage"]],
  };
}

export const SETTINGS_SHEETS: Record<string, SheetKind> = Object.fromEntries(SETTINGS_RESOURCES.map((resource) => [`mill-setting-${resource.key}`, kind(resource)]));
