"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson, getApiErrorMessage } from "@/lib/api-client";

import { formatWhen, MillSelect, MillStatus, type MillLookups } from "./mill-ui";

export const METHOD_LABEL: Record<string, string> = { VISUAL: "Visual", INSTRUMENT: "Instrument", NOT_PERFORMED: "Not performed" };

export type Inspection = {
  id: string;
  outcome: string;
  inspectedAt: string;
  results: Array<{ id: string; specName: string; specVersion: number; method: string; value: number | null; passed: boolean | null; note: string | null }>;
};

export function InspectionResults({ inspection }: { inspection: Inspection }) {
  return (
    <div className="space-y-2">
      <p className="text-sm">
        <MillStatus status={inspection.outcome} /> <span className="text-muted-foreground">· {formatWhen(inspection.inspectedAt)}</span>
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Check</TableHead>
            <TableHead>Method</TableHead>
            <TableHead className="text-right">Reading</TableHead>
            <TableHead>Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {inspection.results.map((result) => (
            <TableRow key={result.id}>
              <TableCell>
                {result.specName} <span className="text-xs text-muted-foreground">v{result.specVersion}</span>
              </TableCell>
              <TableCell>{METHOD_LABEL[result.method] ?? result.method}</TableCell>
              <TableCell className="text-right font-mono">{result.value ?? "—"}</TableCell>
              <TableCell>
                <MillStatus status={result.passed === null ? "INCOMPLETE" : result.passed ? "PASS" : "FAIL"} />
                {result.note ? <span className="text-xs text-muted-foreground"> {result.note}</span> : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type Draft = { method: string; value: string; passed: "" | "yes" | "no"; note: string };

export function InspectForm({ endpoint, invalidate, specs, again }: { endpoint: string; invalidate: readonly unknown[]; specs: MillLookups["specs"]; again: boolean }) {
  const queryClient = useQueryClient();
  const [show, setShow] = useState(!again);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(specs.map((spec) => [spec.id, { method: spec.method, value: "", passed: "", note: "" }])),
  );
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      fetchJson(endpoint, {
        method: "POST",
        body: JSON.stringify({
          results: specs.map((spec) => {
            const draft = drafts[spec.id];
            return {
              specId: spec.id,
              method: draft.method,
              value: spec.resultType === "NUMERIC" && draft.method !== "NOT_PERFORMED" ? draft.value : null,
              passed: spec.resultType === "PASS_FAIL" && draft.method !== "NOT_PERFORMED" ? (draft.passed === "" ? null : draft.passed === "yes") : null,
              note: draft.note || null,
            };
          }),
        }),
      }),
    onSuccess: () => {
      setShow(false);
      void queryClient.invalidateQueries({ queryKey: [...invalidate] });
    },
    onError: (failure) => setError(getApiErrorMessage(failure)),
  });
  const update = (specId: string, patch: Partial<Draft>) => setDrafts((current) => ({ ...current, [specId]: { ...current[specId], ...patch } }));

  if (!show) {
    return (
      <Button variant="secondary" onClick={() => setShow(true)}>
        Inspect again
      </Button>
    );
  }
  return (
    <form
      className="space-y-4 rounded-md border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      {specs.map((spec) => {
        const draft = drafts[spec.id];
        const skipped = draft.method === "NOT_PERFORMED";
        return (
          <div key={spec.id} className="grid gap-2 sm:grid-cols-[1fr_10rem_10rem] sm:items-end">
            <div>
              <div className="font-medium">
                {spec.name}
                {spec.required ? "" : " (optional)"}
              </div>
              <div className="text-xs text-muted-foreground">
                {spec.guidance}
                {spec.maxValue !== null ? ` Limit ${spec.minValue !== null ? `${spec.minValue}–` : "≤ "}${spec.maxValue}${spec.unit ?? ""}.` : ""}
              </div>
            </div>
            <MillSelect
              value={draft.method}
              onChange={(method) => update(spec.id, { method })}
              options={[
                { value: spec.method, label: METHOD_LABEL[spec.method] },
                { value: "NOT_PERFORMED", label: "Not performed" },
              ]}
            />
            {spec.resultType === "NUMERIC" ? (
              <Input
                aria-label={`${spec.name} reading`}
                inputMode="decimal"
                className="font-mono"
                disabled={skipped}
                placeholder={spec.unit ?? "Reading"}
                value={draft.value}
                onChange={(event) => update(spec.id, { value: event.target.value })}
              />
            ) : (
              <MillSelect
                value={draft.passed}
                onChange={(passed) => update(spec.id, { passed: passed as Draft["passed"] })}
                disabled={skipped}
                placeholder="Pass or fail"
                options={[
                  { value: "yes", label: "Pass" },
                  { value: "no", label: "Fail" },
                ]}
              />
            )}
          </div>
        );
      })}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save inspection"}
      </Button>
    </form>
  );
}

