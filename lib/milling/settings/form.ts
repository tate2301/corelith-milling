import type { SettingsField, SettingsResource } from "./fields";
import type { SettingsRow } from "./server";

export type SettingsValues = Record<string, unknown>;

export function settingsStartingValues(resource: SettingsResource, row: SettingsRow | null): SettingsValues {
  const values: SettingsValues = {};
  for (const field of resource.fields) {
    const value = row?.[field.key];
    if (field.type === "boolean") values[field.key] = row ? Boolean(value) : true;
    else if (field.type === "list") values[field.key] = Array.isArray(value) ? value.join(", ") : "";
    else values[field.key] = value == null ? "" : String(value);
  }
  if (!row && resource.key === "qc-specs") Object.assign(values, { point: "INCOMING_MAIZE", method: "VISUAL", resultType: "PASS_FAIL" });
  return values;
}

export function shownSettingsFields(fields: readonly SettingsField[], values: SettingsValues, creating: boolean) {
  return fields.filter((field) => !(creating && field.readOnly) && !(!creating && field.createOnly && field.formOnly) && (!field.numericOnly || values.resultType === "NUMERIC"));
}

export function settingsPayload(resource: SettingsResource, values: SettingsValues, creating: boolean): SettingsValues {
  const out: SettingsValues = {};
  for (const field of resource.fields) {
    if (field.readOnly || (field.createOnly && !creating)) continue;
    out[field.key] = field.numericOnly && values.resultType === "PASS_FAIL" ? null : values[field.key];
  }
  return out;
}

export function passingRule(row: SettingsValues): string {
  if (row.resultType === "PASS_FAIL") return "Pass or fail — follow the instructions";
  const unit = row.unit ? ` ${row.unit}` : "";
  if (row.minValue != null && row.maxValue != null) return `${row.minValue} to ${row.maxValue}${unit} (inclusive)`;
  if (row.minValue != null) return `At least ${row.minValue}${unit}`;
  if (row.maxValue != null) return `At most ${row.maxValue}${unit}`;
  return "Set a passing limit";
}
