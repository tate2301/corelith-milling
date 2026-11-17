"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NONE = "__none__";

/** A labelled choice with an optional "none", for the mill's forms. */
export function MillSelect({
  id,
  value,
  onChange,
  options,
  placeholder = "Choose…",
  allowNone,
  disabled,
}: {
  id?: string;
  value: string | null | undefined;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  placeholder?: string;
  allowNone?: boolean;
  disabled?: boolean;
}) {
  return (
    <Select value={value || (allowNone ? NONE : "")} onValueChange={(next) => onChange(next === NONE ? "" : next)} disabled={disabled}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone ? <SelectItem value={NONE}>None</SelectItem> : null}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
