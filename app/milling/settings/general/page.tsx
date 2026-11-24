"use client";

import "@/components/sheet-form/sheet-form.css";
import "@/components/settings-frame/settings-frame.css";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { SaveBar } from "@/components/settings-frame/save-bar";
import { SheetField } from "@/components/sheet-form/sheet-field";
import { useToast } from "@/components/ui/use-toast";
import { fetchJson, getApiErrorMessage } from "@/lib/api-client";
import { fieldSpec } from "@/lib/milling/sheets/settings";
import { GENERAL_SETTINGS_FIELDS } from "@/lib/milling/settings/fields";
import type { SheetCtx } from "@/lib/workspace/sheet-kind";

type General = Record<string, number>;

const SECTIONS: Array<{ title: string; keys: string[] }> = [
  { title: "Shift", keys: ["shiftHours", "shiftCrewSize"] },
  { title: "Production", keys: ["reconciliationTolerancePct", "extractionTargetPct", "defaultIntakeBagKg"] },
  { title: "Sellers", keys: ["sellerMaxDiscount", "sellerDiscountStep"] },
];

/**
 * Settings › General: the shift template and the mill's tolerances, one form
 * saved together, drawn as core's settings pages are (sections of workspace
 * fields over the save bar).
 */
export default function MillGeneralSettingsPage() {
  const query = useQuery({ queryKey: ["milling", "settings", "general"], queryFn: () => fetchJson<General>("/api/milling/settings/general") });
  return (
    <>
      <PageChrome title="General" />
      {query.isPending ? (
        <div className="cx-sf">
          <div className="cx-sf-state">
            <div className="cx-sf-skel" style={{ width: 160 }} />
            <div className="cx-sf-skel" />
          </div>
        </div>
      ) : query.isError || !query.data ? (
        <p role="alert" className="cx-sf-state cx-sf-state--bad">
          {getApiErrorMessage(query.error)}
        </p>
      ) : (
        <GeneralForm saved={query.data} />
      )}
    </>
  );
}

function GeneralForm({ saved }: { saved: General }) {
  const access = useMillAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canEdit = access.can("settings.manage");
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const values: Record<string, unknown> = { ...Object.fromEntries(Object.entries(saved).map(([key, value]) => [key, String(value)])), ...draft };
  const dirty = Object.entries(draft).filter(([key, value]) => String(value) !== String(saved[key])).length;
  const ctx: SheetCtx = { id: null, params: new URLSearchParams() } as unknown as SheetCtx;

  const save = useMutation({
    mutationFn: () => fetchJson<General>("/api/milling/settings/general", { method: "PUT", body: JSON.stringify(values) }),
    onSuccess: (next) => {
      queryClient.setQueryData(["milling", "settings", "general"], next);
      setDraft({});
      toast({ title: "Saved", variant: "success" });
    },
    onError: (failure) => setError(getApiErrorMessage(failure)),
  });
  const submit = () => {
    setError(null);
    if (canEdit && dirty && !save.isPending) save.mutate();
  };

  return (
    <div className="cx-sf">
      <div className="cx-sf-body">
        <div className="cx-sf-main">
          <div className="cx-sf-scroll">
            <form
              className="cx-sf-form"
              aria-label="General"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              {SECTIONS.map((section) => (
                <section key={section.title} className="cx-sheet__section">
                  <h3 className="cx-sheet__section-title">{section.title}</h3>
                  <div className="sf-grid">
                    {section.keys.map((key) => {
                      const setting = GENERAL_SETTINGS_FIELDS.find((field) => field.key === key);
                      if (!setting) return null;
                      const field = { ...fieldSpec(setting), id: key, half: true, ...(canEdit ? {} : { disabled: () => true }) };
                      return (
                        <div key={key} className="sf-cell sf-cell--half">
                          <SheetField field={field} controlId={`mill-general-${key}`} ctx={ctx} values={values} currency="US$" onChange={(value) => setDraft((current) => ({ ...current, [key]: value }))} />
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </form>
          </div>
          <SaveBar
            count={canEdit ? dirty : 0}
            line={canEdit ? "Changes apply to the mill after saving." : "Your mill groups do not allow changing these settings."}
            error={error}
            saving={save.isPending}
            onDiscard={() => {
              setDraft({});
              setError(null);
            }}
            onSave={submit}
          />
        </div>
      </div>
    </div>
  );
}
