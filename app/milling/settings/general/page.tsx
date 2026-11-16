"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { FieldInput } from "@/components/milling/settings-resource";
import { MillSettingsShell } from "@/components/milling/settings-shell";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { fetchJson, getApiErrorMessage } from "@/lib/api-client";
import { GENERAL_SETTINGS_FIELDS } from "@/lib/milling/settings/fields";

type General = Record<string, number>;

/** Tolerances and the shift template: one form, saved together. */
export default function MillGeneralSettingsPage() {
  const query = useQuery({ queryKey: ["milling", "settings", "general"], queryFn: () => fetchJson<General>("/api/milling/settings/general") });
  return (
    <MillSettingsShell>
      {query.isLoading ? (
        <Skeleton className="h-48 w-full max-w-lg" />
      ) : query.isError || !query.data ? (
        <Alert variant="destructive">
          <AlertDescription>{getApiErrorMessage(query.error)}</AlertDescription>
        </Alert>
      ) : (
        <GeneralForm saved={query.data} />
      )}
    </MillSettingsShell>
  );
}

function GeneralForm({ saved }: { saved: General }) {
  const access = useMillAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canEdit = access.can("settings.manage");
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(Object.entries(saved).map(([key, value]) => [key, String(value)])),
  );
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => fetchJson<General>("/api/milling/settings/general", { method: "PUT", body: JSON.stringify(values) }),
    onSuccess: (next) => {
      queryClient.setQueryData(["milling", "settings", "general"], next);
      toast({ title: "Saved", variant: "success" });
    },
    onError: (failure) => setError(getApiErrorMessage(failure)),
  });

  return (
    <form
      className="max-w-lg space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      {GENERAL_SETTINGS_FIELDS.map((field) => (
        <FieldInput
          key={field.key}
          field={field}
          value={values[field.key]}
          fixed={!canEdit}
          options={[]}
          onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
        />
      ))}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {canEdit ? (
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      ) : null}
    </form>
  );
}
