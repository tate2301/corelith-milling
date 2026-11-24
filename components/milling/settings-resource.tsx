"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import { useState } from "react";
import Link from "next/link";
import { settingsStartingValues, settingsPayload, shownSettingsFields, passingRule } from "@/lib/milling/settings/form";

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
        { method: creating ? "POST" : "PATCH", body: JSON.stringify(settingsPayload(resource, values, creating)) },
      ),
    onSuccess: () => {
      setEditing(null);
      toast({ title: creating ? `${capitalise(resource.singular)} added` : "Saved", variant: "success" });
      void queryClient.invalidateQueries({ queryKey });
      if (resource.key === "locations") void queryClient.invalidateQueries({ queryKey: ["milling", "stock"] });
    },
    onError: (error) => setFormError(getApiErrorMessage(error)),
  });

  const open = (row: SettingsRow | "new") => {
    setEditing(row);
    setFormError(null);
    setValues(settingsStartingValues(resource, row === "new" ? null : row));
  };

  const options = query.data?.options ?? {};
  const rows = query.data?.rows ?? [];
  const columns = resource.fields.filter((field) => !field.formOnly && (resource.key !== "qc-specs" || !["unit", "minValue", "maxValue", "version", "code"].includes(field.key)));
  const shownFields = shownSettingsFields(resource.fields, values, creating);

  return (
    <div className="space-y-4">
      <SectionHeading
        variant="form"
        count={query.data ? rows.length : undefined}
        action={resource.canCreate && canEdit ? <Button onClick={() => open("new")}>Add a {resource.singular}</Button> : undefined}
      >{resource.label}</SectionHeading>
      <p className="text-sm text-muted-foreground">{resource.description}</p>
      {resource.key === "vehicles" ? <Link href="/maintenance/equipment" className="underline">Add a vehicle in Maintenance</Link> : null}
      {resource.key === "recipes" ? <p className="text-sm">Choose a packed product in bags, a bulk product in kilograms and an optional empty bag. <Link href="/stores/catalogue" className="underline">Manage products in Stores</Link>.</p> : null}
      {resource.key === "locations" ? <p className="text-sm">A bin is a stock location with kind Bin. <Link href="/preferences/organization/sites" className="underline">Manage sites</Link>.</p> : null}
      {resource.key === "qc-specs" ? <p className="text-sm">Pass/fail checks use written instructions. Numeric readings use inclusive passing limits, for example moisture at most 12.5%. Click a check to change it.</p> : null}

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
                {resource.key === "qc-specs" ? <TableHead>Passing rule</TableHead> : null}
                {canEdit ? <TableHead><span className="sr-only">Change</span></TableHead> : null}
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
                      {field.key === "bulkProductId" ? String(row.bulk ?? "—") : display(field, row[field.key], options)}
                    </TableCell>
                  ))}
                  {resource.key === "qc-specs" ? <TableCell><div>{passingRule(row)}</div><p className="text-xs text-muted-foreground">{String(row.guidance ?? "")}</p></TableCell> : null}
                  {canEdit ? <TableCell><Button variant="ghost" onClick={(event) => { event.stopPropagation(); open(row); }} aria-label={`Change ${String(row.name ?? row.location ?? row.vehicle ?? row.packed ?? resource.singular)}`}>Change</Button></TableCell> : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(next) => (next || save.isPending ? null : setEditing(null))}>
        <DialogContent className="max-h-screen overflow-y-auto">
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
              if (canEdit && !save.isPending) save.mutate();
            }}
          >
            {resource.key === "qc-specs" ? (
              <>
                <QualityFields title="1. Where and what to check" fields={shownFields.filter((field) => ["point", "code", "name"].includes(field.key))} values={values} creating={creating} busy={save.isPending} options={options} onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))} />
                <QualityFields title="2. How to judge a pass" fields={shownFields.filter((field) => ["method", "resultType", "unit", "minValue", "maxValue", "guidance"].includes(field.key))} values={values} creating={creating} busy={save.isPending} options={options} onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))} />
                <p role="status" className="text-sm">{passingRule({ ...values, minValue: values.minValue === "" ? null : values.minValue, maxValue: values.maxValue === "" ? null : values.maxValue })}</p>
                <QualityFields title="3. Release rule" fields={shownFields.filter((field) => ["required", "version", "isActive"].includes(field.key))} values={values} creating={creating} busy={save.isPending} options={options} onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))} />
              </>
            ) : shownFields.map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                value={values[field.key]}
                fixed={save.isPending || Boolean(field.readOnly || (field.createOnly && !creating))}
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
            <Button variant="secondary" disabled={save.isPending} onClick={() => setEditing(null)}>
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

function QualityFields({ title, fields, values, creating, busy, options, onChange }: {
  title: string; fields: SettingsField[]; values: Values; creating: boolean; busy: boolean; options: SettingsOptions; onChange: (key: string, value: unknown) => void;
}) {
  return <fieldset className="space-y-3"><legend className="font-semibold">{title}</legend>{fields.map((field) => <FieldInput key={field.key} field={field} value={values[field.key]} fixed={busy || Boolean(field.readOnly || (field.createOnly && !creating))} options={field.options ?? options[field.key] ?? []} onChange={(value) => onChange(field.key, value)} />)}</fieldset>;
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
          value={value ? String(value) : field.required ? "" : NONE}
          onValueChange={(next) => onChange(next === NONE ? "" : next)}
          disabled={fixed}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder="Choose…" />
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
      ) : field.key === "guidance" ? (
        <textarea id={id} className="input w-full" value={String(value ?? "")} disabled={fixed} rows={3} placeholder="For example: no live insects visible in the sample." onChange={(event) => onChange(event.target.value)} />
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
