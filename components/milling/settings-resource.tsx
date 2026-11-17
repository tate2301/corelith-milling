"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { fetchJson, getApiErrorMessage } from "@/lib/api-client";
import type { SettingsField, SettingsResource } from "@/lib/milling/settings/fields";
import type { SettingsList, SettingsOptions, SettingsRow } from "@/lib/milling/settings/server";

import { useMillAccess } from "./use-mill-access";
import { SectionHeading } from "@/components/management/ui";

const NONE = "__none__";

type Values = Record<string, unknown>;

function display(field: SettingsField, value: unknown, options: SettingsOptions): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field.type === "boolean") return value ? "Yes" : "No";
  if (field.type === "list") return Array.isArray(value) ? value.join(", ") || "—" : String(value);
  if (field.type === "select") {
    const choices = field.options ?? options[field.key] ?? [];
    return choices.find((choice) => choice.value === value)?.label ?? String(value);
  }
  if (field.type === "number") return `${value}${field.unit ? ` ${field.unit}` : ""}`;
  return String(value);
}

/** The form's starting values: the row's, or each field's empty value for a new row. */
function startingValues(fields: readonly SettingsField[], row: SettingsRow | null): Values {
  const values: Values = {};
  for (const field of fields) {
    const value = row?.[field.key];
    if (field.type === "boolean") values[field.key] = row ? Boolean(value) : true;
    else if (field.type === "list") values[field.key] = Array.isArray(value) ? value.join(", ") : "";
    else values[field.key] = value === null || value === undefined ? "" : String(value);
  }
  return values;
}

/** Only what the person may send: no read-only fields, and no create-only ones on an edit. */
function payload(fields: readonly SettingsField[], values: Values, creating: boolean): Values {
  const out: Values = {};
  for (const field of fields) {
    if (field.readOnly || (field.createOnly && !creating)) continue;
    out[field.key] = values[field.key];
  }
  return out;
}

/**
 * One settings list: the table, and a form to add or change a row. Drawn
 * entirely from the resource's description in `lib/milling/settings/fields.ts`.
 */
export function SettingsResourceView({ resource }: { resource: SettingsResource }) {
  const access = useMillAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canEdit = access.can("settings.manage");
  const queryKey = ["milling", "settings", resource.key];
  const [editing, setEditing] = useState<SettingsRow | "new" | null>(null);
  const [values, setValues] = useState<Values>({});
  const [formError, setFormError] = useState<string | null>(null);

  const query = useQuery({
    queryKey,
    queryFn: () => fetchJson<SettingsList>(`/api/milling/settings/${resource.key}`),
  });

  const creating = editing === "new";
  const save = useMutation({
    mutationFn: () =>
      fetchJson<SettingsRow>(
        creating ? `/api/milling/settings/${resource.key}` : `/api/milling/settings/${resource.key}/${(editing as SettingsRow).id}`,
        { method: creating ? "POST" : "PATCH", body: JSON.stringify(payload(resource.fields, values, creating)) },
      ),
    onSuccess: () => {
      setEditing(null);
      toast({ title: creating ? `${capitalise(resource.singular)} added` : "Saved", variant: "success" });
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => setFormError(getApiErrorMessage(error)),
  });

  const open = (row: SettingsRow | "new") => {
    setEditing(row);
    setFormError(null);
    setValues(startingValues(resource.fields, row === "new" ? null : row));
  };

  const options = query.data?.options ?? {};
  const rows = query.data?.rows ?? [];
  const columns = resource.fields.filter((field) => !field.formOnly);

  return (
    <div className="space-y-4">
      <SectionHeading
        variant="form"
        count={query.data ? rows.length : undefined}
        action={resource.canCreate && canEdit ? <Button onClick={() => open("new")}>Add a {resource.singular}</Button> : undefined}
      >{resource.label}</SectionHeading>

      {query.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{getApiErrorMessage(query.error)}</AlertDescription>
        </Alert>
      ) : query.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState title={`No ${resource.label.toLowerCase()} yet`} body={resource.canCreate ? `Add the first ${resource.singular}.` : resource.description} />
      ) : (
        <div className="overflow-x-auto">
          <Table hideControlsWhenSinglePage>
            <TableHeader>
              <TableRow>
                {columns.map((field) => (
                  <TableHead key={field.key} className={field.type === "number" ? "text-right" : undefined}>
                    {field.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={canEdit ? "cursor-pointer" : undefined}
                  onClick={canEdit ? () => open(row) : undefined}
                >
                  {columns.map((field) => (
                    <TableCell key={field.key} className={field.type === "number" ? "text-right font-mono" : undefined}>
                      {display(field, row[field.key], options)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(next) => (next ? null : setEditing(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{creating ? `Add a ${resource.singular}` : `Change this ${resource.singular}`}</DialogTitle>
            <DialogDescription>{resource.description}</DialogDescription>
          </DialogHeader>
          <form
            id={`mill-settings-${resource.key}`}
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              setFormError(null);
              save.mutate();
            }}
          >
            {resource.fields.map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                value={values[field.key]}
                fixed={Boolean(field.readOnly || (field.createOnly && !creating))}
                options={field.options ?? options[field.key] ?? []}
                onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
              />
            ))}
            {formError ? (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}
          </form>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" form={`mill-settings-${resource.key}`} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function capitalise(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function FieldInput({
  field,
  value,
  fixed,
  options,
  onChange,
}: {
  field: SettingsField;
  value: unknown;
  fixed: boolean;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: unknown) => void;
}) {
  const id = `field-${field.key}`;
  if (field.type === "boolean") {
    return (
      <div className="flex items-start gap-2">
        <Checkbox id={id} checked={Boolean(value)} disabled={fixed} onCheckedChange={(on) => onChange(on === true)} />
        <div>
          <Label htmlFor={id}>{field.label}</Label>
          {field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>
        {field.label}
        {field.unit ? <span className="text-muted-foreground"> ({field.unit})</span> : null}
      </Label>
      {field.type === "select" ? (
        <Select
          value={value ? String(value) : NONE}
          onValueChange={(next) => onChange(next === NONE ? "" : next)}
          disabled={fixed}
        >
          <SelectTrigger id={id}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.required ? null : <SelectItem value={NONE}>None</SelectItem>}
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={id}
          value={String(value ?? "")}
          disabled={fixed}
          inputMode={field.type === "number" ? "decimal" : undefined}
          className={field.type === "number" ? "font-mono" : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}
    </div>
  );
}
