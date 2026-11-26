import { SETTINGS_RESOURCES, type SettingsField, type SettingsResource } from "@/lib/milling/settings/fields";
import type { ListColumn, ListSpec, ReportDefinition } from "@/lib/reports/types";

import { LIST_BASE, mill, MILL_VIEW } from "./shared";

/**
 * The mill's settings lists (destinations, duties, process route, checks,
 * vehicles, locations, recipes) drawn by ListFrame, each from the one
 * description in lib/milling/settings/fields.ts that also validates what the
 * API accepts. A row opens its sheet; Add opens it empty.
 */

function column(field: SettingsField, first: boolean): ListColumn {
  const base = { key: field.key, label: field.unit ? `${field.label}, ${field.unit}` : field.label, align: "start" as const, priority: (first ? 1 : 2) as 1 | 2 };
  if (first) return { ...base, kind: "text", cell: "link", width: "minmax(180px,1.4fr)" };
  if (field.type === "number") return { ...base, kind: "number", cell: "num", align: "end", width: "120px" };
  if (field.type === "boolean") return { ...base, kind: "status", cell: "dot", tones: { Yes: "ok", No: "hollow" }, width: "110px" };
  if (field.key === "code") return { ...base, kind: "code", cell: "mono", width: "130px" };
  if (field.type === "list") return { ...base, kind: "text", cell: "muted", width: "minmax(160px,1.2fr)", priority: 3 };
  return { ...base, kind: "text", cell: "text", width: "minmax(130px,1fr)" };
}

/** The row's name: its first text field that is not a code. */
export function nameField(resource: SettingsResource): SettingsField {
  return resource.fields.find((field) => field.type === "text" && field.key !== "code") ?? resource.fields[0]!;
}

/** Columns a list leaves to the sheet: a check's limits read as one passing rule instead. */
const HIDDEN: Partial<Record<string, string[]>> = { "qc-specs": ["unit", "minValue", "maxValue", "version", "code"] };

function spec(resource: SettingsResource): ListSpec {
  const shown = resource.fields.filter((field) => !field.formOnly && !(HIDDEN[resource.key] ?? []).includes(field.key));
  const name = nameField(resource);
  const ordered = [name, ...shown.filter((field) => field !== name)];
  const sheet = `mill-setting-${resource.key}`;
  return {
    noun: resource.label.toLowerCase(),
    read: MILL_VIEW,
    search: { placeholder: `Search ${resource.label.toLowerCase()}`, keys: ordered.filter((field) => field.type === "text" || field.type === "select").map((field) => field.key) },
    filters: [],
    sorts: [{ key: "name", label: "Name A–Z", rules: [{ column: name.key, dir: "asc" }] }],
    columns: [
      ...ordered.map((field, index) => column(field, index === 0)),
      ...(resource.key === "qc-specs" ? [{ key: "passingRule", label: "Passing rule", kind: "text" as const, cell: "muted" as const, width: "minmax(200px,1.4fr)", align: "start" as const, priority: 2 as const }] : []),
    ],
    rowHref: `/milling/settings/${resource.key}?sheet=${sheet}&id={id}`,
    rowMenu: [{ key: "edit", label: "Change", requires: mill("settings.manage"), do: { sheet } }],
    bulk: [{ key: "export" }],
    ...(resource.canCreate ? { primary: { label: `Add a ${resource.singular}`, icon: "plus" as const, requires: mill("settings.manage"), sheet } } : {}),
    card: { title: name.key, figure: "", meta: ordered.slice(1, 3).map((field) => `{${field.key}}`).join(" · ") },
    empty: {
      icon: "Gear",
      title: `No ${resource.label.toLowerCase()} yet`,
      line: resource.description,
      ...(resource.canCreate ? { primary: { label: `Add a ${resource.singular}`, sheet, requires: mill("settings.manage") } } : {}),
    },
  };
}

export const SETTINGS_LISTS: ReportDefinition[] = SETTINGS_RESOURCES.map((resource) => {
  const list = spec(resource);
  return {
    ...LIST_BASE,
    key: `milling-setting-${resource.key}`,
    title: resource.label,
    href: `/milling/settings/${resource.key}`,
    params: [],
    columns: list.columns,
    defaults: { sort: [{ column: nameField(resource).key, dir: "asc" }] },
    list,
  };
});
