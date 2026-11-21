import type { SheetValues } from "@/lib/workspace/sheet-kind";

/**
 * A choice in a mill sheet: a `text` field with options draws as a select of
 * labels; the ids travel beside it in the values (`_<field>`) and are looked
 * up again on submit. "None" leads an optional one.
 */
export type Choice = { id: string; label: string };

export const NONE = "None";

export function labels(values: SheetValues, field: string, optional = false): string[] {
  const options = ((values[`_${field}`] as Choice[] | undefined) ?? []).map((option) => option.label);
  return optional ? [NONE, ...options] : options;
}

export function idOf(values: SheetValues, field: string): string | null {
  const label = values[field];
  if (!label || label === NONE) return null;
  return ((values[`_${field}`] as Choice[] | undefined) ?? []).find((option) => option.label === label)?.id ?? null;
}

export const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
export const numberOf = (value: unknown) => {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
