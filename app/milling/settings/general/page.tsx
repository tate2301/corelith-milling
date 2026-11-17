"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { FieldInput } from "@/components/milling/settings-resource";
import { MillSettingsShell } from "@/components/milling/settings-shell";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SaveBar } from "@/components/settings-frame/save-bar";
import { SectionHeading } from "@/components/management/ui";
import "@/components/settings-frame/settings-frame.css";
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
      {query.isPending ? (
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
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const values = { ...Object.fromEntries(Object.entries(saved).map(([key, value]) => [key, String(value)])), ...draft };
  const dirty = Object.entries(draft).filter(([key, value]) => String(value) !== String(saved[key])).length;
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => fetchJson<General>("/api/milling/settings/general", { method: "PUT", body: JSON.stringify(values) }),
    onSuccess: (next) => {
      queryClient.setQueryData(["milling", "settings", "general"], next);
      setDraft({});
      toast({ title: "Saved", variant: "success" });
    },
    onError: (failure) => setError(getApiErrorMessage(failure)),
  });

  return (
    <div className="cx-sf cx-sf--embedded">
      <SectionHeading variant="form">Shift and tolerances</SectionHeading>
      <form
        className="max-w-lg space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          if (canEdit && dirty && !save.isPending) save.mutate();
        }}
      >
        {GENERAL_SETTINGS_FIELDS.map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            value={values[field.key]}
            fixed={!canEdit || save.isPending}
            options={[]}
            onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value }))}
          />
        ))}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </form>
      <SaveBar count={canEdit ? dirty : 0} line={canEdit ? "Changes apply to the mill after saving." : "Your mill groups do not allow changing these settings."} error={error} saving={save.isPending} onDiscard={() => { setDraft({}); setError(null); }} onSave={() => { setError(null); if (canEdit && dirty && !save.isPending) save.mutate(); }} />
    </div>
  );
}
