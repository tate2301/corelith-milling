"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { Field, FormError, isoFromLocal, localNow, Stat } from "@/components/milling/form-bits";
import { formatKg, formatWhen, MillSelect, MillStatus, useMillLookups } from "@/components/milling/mill-ui";
import { RecordHistory } from "@/components/milling/record-history";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { useMillPost } from "@/components/milling/use-mill-post";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SectionTab, SectionTabs } from "@/components/ui/section-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/api-client";

type RouteStage = { id: string; code: string; name: string; required: boolean; capturesQuantities: boolean; equipment: Array<{ code: string; availability: string }> };
type StageRow = { id: string; stageId: string; stageCode: string; startedAt: string; endedAt: string | null; inputKg: number | null; inputEstimated: boolean; removedKg: number | null; removedEstimated: boolean; waterLitres: number | null; moistureAfterPct: number | null; observations: string | null; abnormal: boolean; operator: string | null };
type Detail = {
  batch: { id: string; code: string; status: string; shiftId: string | null; maizeIssuedKg: number; maizeCost: number; waterAddedKg: number; outputKg: number | null; separatedKg: number | null; inProcessChangeKg: number | null; unaccountedKg: number | null; variancePct: number | null; yields: Record<string, number> | null; startedAt: string; completedAt: string | null };
  order: { id: string; code: string } | null;
  route: RouteStage[];
  stages: StageRow[];
  sources: Array<{ id: string; quantityKg: number; location: string; lot?: { code: string } }>;
  outputs: Array<{ id: string; quantityKg: number; isEstimated: boolean; location: string; lot?: { id: string; code: string; status: string }; product?: { name: string } }>;
  exceptions: Array<{ id: string; code: string; title: string; status: string; decision: string | null }>;
  downtime: Array<{ id: string; cause: string; category: string; startedAt: string; endedAt: string | null }>;
};

const n = (value: unknown) => (value === null || value === undefined ? null : Number(value));

/** One batch: maize in, the route stage by stage, product out, and the material balance. */
export default function BatchPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<"batch" | "history">("batch");
  const query = useQuery({ queryKey: ["milling", "batch", id], queryFn: () => fetchJson<Detail>(`/api/milling/batches/${id}`) });
  if (query.isPending || !query.data) return <Skeleton className="m-4 h-96" />;
  const { batch } = query.data;
  return (
    <>
      <PageChrome title={`Batch ${batch.code}`} />
      <div className="space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <MillStatus status={batch.status} />
          <span className="text-sm text-muted-foreground">
            started {formatWhen(batch.startedAt)}
            {query.data.order ? (
              <>
                {" · "}
                <Link className="underline" href={`/milling/plan/${query.data.order.id}`}>
                  {query.data.order.code}
                </Link>
              </>
            ) : null}
          </span>
        </div>
        <SectionTabs label="Batch sections">
          <SectionTab onClick={() => setTab("batch")} active={tab === "batch"}>
            Batch
          </SectionTab>
          <SectionTab onClick={() => setTab("history")} active={tab === "history"}>
            History
          </SectionTab>
        </SectionTabs>
        {tab === "history" ? <RecordHistory entityType="MillingBatch" entityId={batch.id} /> : <BatchBody detail={query.data} />}
      </div>
    </>
  );
}

function BatchBody({ detail }: { detail: Detail }) {
  const { batch, route, stages, sources, outputs, exceptions } = detail;
  const access = useMillAccess();
  const working = ["OPEN", "IN_PROGRESS"].includes(batch.status);
  const [stage, setStage] = useState<RouteStage | null>(null);
  const open = exceptions.filter((exception) => exception.status === "OPEN");
  return (
    <div className="space-y-8">
      {open.length ? (
        <Alert variant="warning">
          <AlertTitle>Waiting for a decision</AlertTitle>
          <AlertDescription>
            {open.map((exception) => `${exception.code}: ${exception.title}`).join("; ")}.{" "}
            <Link className="underline" href="/milling/exceptions">
              Open the exceptions queue
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Maize in</h2>
          {working && access.can("batch.run") ? <IssueMaize batchId={batch.id} /> : null}
        </div>
        {sources.length ? (
          <ul className="text-sm">
            {sources.map((source) => (
              <li key={source.id}>
                <span className="font-mono">{source.lot?.code}</span> from {source.location}: <span className="font-mono">{formatKg(Number(source.quantityKg))}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No maize issued yet.</p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Route</h2>
        <ol className="divide-y rounded-md border">
          {route.map((step, index) => {
            const done = stages.filter((row) => row.stageId === step.id);
            const down = step.equipment.filter((machine) => machine.availability !== "AVAILABLE");
            return (
              <li key={step.id} className="flex flex-wrap items-start justify-between gap-2 p-3">
                <div className="space-y-1">
                  <div className="font-medium">
                    {index + 1}. {step.name} {step.required ? null : <span className="text-xs text-muted-foreground">(optional)</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{step.equipment.map((machine) => machine.code).join(", ")}</div>
                  {down.length ? <div className="text-xs">Not released: {down.map((machine) => machine.code).join(", ")}</div> : null}
                  {done.map((row) => (
                    <div key={row.id} className="text-sm">
                      {formatWhen(row.startedAt)}
                      {row.inputKg !== null ? ` · in ${formatKg(n(row.inputKg))}${row.inputEstimated ? " est." : ""}` : ""}
                      {row.removedKg !== null ? ` · removed ${formatKg(n(row.removedKg))}${row.removedEstimated ? " est." : ""}` : ""}
                      {row.waterLitres !== null ? ` · ${row.waterLitres} L water` : ""}
                      {row.moistureAfterPct !== null ? ` · ${row.moistureAfterPct}% after` : ""}
                      {row.abnormal ? " · abnormal" : ""}
                      {row.observations ? ` · ${row.observations}` : ""}
                      {row.operator ? ` · ${row.operator}` : ""}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <MillStatus status={done.length ? "COMPLETED" : step.required ? "TO_DO" : "OPTIONAL"} />
                  {working && access.can("stage.record") ? (
                    <Button size="sm" variant="secondary" onClick={() => setStage(step)}>
                      Record
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
        {stage ? <StageDialog batch={batch} stage={stage} onClose={() => setStage(null)} /> : null}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Product out</h2>
          {working && access.can("stage.record") ? <RecordOutput batchId={batch.id} /> : null}
        </div>
        {outputs.length ? (
          <Table hideControlsWhenSinglePage>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Lot</TableHead>
                <TableHead>Into</TableHead>
                <TableHead className="text-right">Weight</TableHead>
                <TableHead>QC</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outputs.map((output) => (
                <TableRow key={output.id}>
                  <TableCell>{output.product?.name}</TableCell>
                  <TableCell className="font-mono">{output.lot?.code}</TableCell>
                  <TableCell>{output.location}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatKg(Number(output.quantityKg))}
                    {output.isEstimated ? " est." : ""}
                  </TableCell>
                  <TableCell>
                    <MillStatus status={output.lot?.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing out yet.</p>
        )}
      </section>

      <Balance detail={detail} />
    </div>
  );
}

function Balance({ detail }: { detail: Detail }) {
  const { batch } = detail;
  const access = useMillAccess();
  const complete = useMillPost({ done: "Batch updated" });
  const [change, setChange] = useState(batch.inProcessChangeKg === null ? "" : String(batch.inProcessChangeKg));
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Material balance</h2>
      <dl className="grid gap-4 text-sm sm:grid-cols-4">
        <Stat label="Maize in">
          <span className="font-mono">{formatKg(n(batch.maizeIssuedKg))}</span>
        </Stat>
        <Stat label="Water added">
          <span className="font-mono">{formatKg(n(batch.waterAddedKg))}</span>
        </Stat>
        <Stat label="Product out">
          <span className="font-mono">{formatKg(n(batch.outputKg))}</span>
        </Stat>
        <Stat label="Separated">
          <span className="font-mono">{formatKg(n(batch.separatedKg))}</span>
        </Stat>
        <Stat label="Change in process">
          <span className="font-mono">{formatKg(n(batch.inProcessChangeKg))}</span>
        </Stat>
        <Stat label="Unaccounted">
          <span className="font-mono">
            {formatKg(n(batch.unaccountedKg))}
            {batch.variancePct !== null ? ` (${Number(batch.variancePct).toFixed(1)}%)` : ""}
          </span>
        </Stat>
        <Stat label="Maize cost">
          <span className="font-mono">{Number(batch.maizeCost).toFixed(2)}</span>
        </Stat>
        {batch.yields
          ? Object.entries(batch.yields).map(([code, pct]) => (
              <Stat key={code} label={`Yield ${code}`}>
                <span className="font-mono">{pct.toFixed(1)}%</span>
              </Stat>
            ))
          : null}
      </dl>
      {batch.status !== "COMPLETED" && access.can("batch.approve") ? (
        <div className="flex max-w-xl flex-wrap items-end gap-3">
          <Field id="in-process" label="Change in material in the line (kg)" help="Left in machines and bins now, less what was there when the batch started.">
            <Input id="in-process" className="w-40 font-mono" inputMode="decimal" value={change} onChange={(event) => setChange(event.target.value)} />
          </Field>
          <Button disabled={complete.pending} onClick={() => complete.post(`/api/milling/batches/${batch.id}/complete`, { inProcessChangeKg: change })}>
            Complete the batch
          </Button>
        </div>
      ) : null}
      <FormError error={complete.error} />
    </section>
  );
}

function StageDialog({ batch, stage, onClose }: { batch: Detail["batch"]; stage: RouteStage; onClose: () => void }) {
  const save = useMillPost({ done: `${stage.name} recorded`, onDone: onClose });
  const [values, setValues] = useState<Record<string, string>>({ startedAt: localNow(), endedAt: "" });
  const [flags, setFlags] = useState({ inputEstimated: true, removedEstimated: true, abnormal: false });
  const set = (key: string) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const conditioning = stage.code === "CONDITION";
  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{stage.name}</DialogTitle>
          <DialogDescription>{stage.equipment.map((machine) => machine.code).join(", ")}. Mark each quantity as estimated unless it was weighed.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field id="st-start" label="Started">
              <Input id="st-start" type="datetime-local" value={values.startedAt} onChange={set("startedAt")} />
            </Field>
            <Field id="st-end" label="Ended">
              <Input id="st-end" type="datetime-local" value={values.endedAt} onChange={set("endedAt")} />
            </Field>
          </div>
          {stage.capturesQuantities ? (
            <div className="grid grid-cols-2 gap-3">
              <Field id="st-in" label="Input kg">
                <Input id="st-in" className="font-mono" inputMode="decimal" value={values.inputKg ?? ""} onChange={set("inputKg")} />
              </Field>
              <Field id="st-removed" label="Removed kg" help="Dust, husks, stones, fines">
                <Input id="st-removed" className="font-mono" inputMode="decimal" value={values.removedKg ?? ""} onChange={set("removedKg")} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={flags.inputEstimated} onCheckedChange={(on) => setFlags((current) => ({ ...current, inputEstimated: on === true }))} /> Input estimated
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={flags.removedEstimated} onCheckedChange={(on) => setFlags((current) => ({ ...current, removedEstimated: on === true }))} /> Removed estimated
              </label>
            </div>
          ) : null}
          {conditioning ? (
            <div className="grid grid-cols-3 gap-3">
              <Field id="st-water" label="Water (L)">
                <Input id="st-water" className="font-mono" inputMode="decimal" value={values.waterLitres ?? ""} onChange={set("waterLitres")} />
              </Field>
              <Field id="st-mb" label="Moisture before %">
                <Input id="st-mb" className="font-mono" inputMode="decimal" value={values.moistureBeforePct ?? ""} onChange={set("moistureBeforePct")} />
              </Field>
              <Field id="st-ma" label="Moisture after %">
                <Input id="st-ma" className="font-mono" inputMode="decimal" value={values.moistureAfterPct ?? ""} onChange={set("moistureAfterPct")} />
              </Field>
            </div>
          ) : null}
          <Field id="st-obs" label="Observations">
            <Textarea id="st-obs" rows={2} value={values.observations ?? ""} onChange={set("observations")} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={flags.abnormal} onCheckedChange={(on) => setFlags((current) => ({ ...current, abnormal: on === true }))} /> Something abnormal (contamination, unusual product)
          </label>
          <FormError error={save.error} />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.pending}
            onClick={() =>
              save.post(`/api/milling/batches/${batch.id}/stage`, {
                stageId: stage.id,
                shiftId: batch.shiftId,
                ...values,
                startedAt: isoFromLocal(values.startedAt),
                endedAt: isoFromLocal(values.endedAt),
                observations: values.observations || null,
                ...flags,
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type StockProduct = { id: string; code: string | null; name: string; lots: Array<{ id: string; code: string; status: string; balances: Array<{ stockLocationId: string; location: string; quantity: number; reserved: number }> }> };

function IssueMaize({ batchId }: { batchId: string }) {
  const [open, setOpen] = useState(false);
  const stock = useQuery({ queryKey: ["milling", "stock"], queryFn: () => fetchJson<{ products: StockProduct[] }>("/api/milling/stock"), enabled: open });
  const [choice, setChoice] = useState("");
  const [kg, setKg] = useState("");
  const issue = useMillPost({ done: "Maize issued", onDone: () => setOpen(false) });
  const options = (stock.data?.products ?? [])
    .filter((product) => product.code === "MAIZE")
    .flatMap((product) => product.lots.filter((lot) => lot.status === "AVAILABLE").flatMap((lot) => lot.balances.map((balance) => ({ value: `${lot.id}|${balance.stockLocationId}`, label: `${lot.code} at ${balance.location}: ${formatKg(balance.quantity)}${balance.reserved ? ` (${formatKg(balance.reserved)} reserved)` : ""}` }))));
  const [lotId, stockLocationId] = choice.split("|");
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Issue maize
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue maize to the batch</DialogTitle>
            <DialogDescription>Only released lots are offered. The order&apos;s reservation on the lot is used first.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <MillSelect value={choice} onChange={setChoice} placeholder="Lot and place" options={options} />
            <Field id="issue-kg" label="Kg">
              <Input id="issue-kg" className="font-mono" inputMode="decimal" value={kg} onChange={(event) => setKg(event.target.value)} />
            </Field>
            <FormError error={issue.error} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={issue.pending || !choice} onClick={() => issue.post(`/api/milling/batches/${batchId}/issue`, { lotId, stockLocationId, quantityKg: kg })}>
              Issue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RecordOutput({ batchId }: { batchId: string }) {
  const lookups = useMillLookups();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({ productId: "", stockLocationId: "", quantityKg: "" });
  const [estimated, setEstimated] = useState(false);
  const save = useMillPost({ done: "Output recorded", onDone: () => setOpen(false) });
  const bulk = (lookups.data?.products ?? []).filter((product) => product.category === "Bulk product");
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Record output
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Product out</DialogTitle>
            <DialogDescription>Bulk product goes into the batch&apos;s lot for it, on hold until QC releases it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <MillSelect value={values.productId} onChange={(productId) => setValues((current) => ({ ...current, productId }))} placeholder="Product" options={bulk.map((product) => ({ value: product.id, label: product.name }))} />
            <MillSelect value={values.stockLocationId} onChange={(stockLocationId) => setValues((current) => ({ ...current, stockLocationId }))} placeholder="Into" options={(lookups.data?.locations ?? []).map((location) => ({ value: location.id, label: `${location.code} · ${location.name}` }))} />
            <Field id="out-kg" label="Kg">
              <Input id="out-kg" className="font-mono" inputMode="decimal" value={values.quantityKg} onChange={(event) => setValues((current) => ({ ...current, quantityKg: event.target.value }))} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={estimated} onCheckedChange={(on) => setEstimated(on === true)} /> Estimated, not weighed
            </label>
            <FormError error={save.error} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={save.pending} onClick={() => save.post(`/api/milling/batches/${batchId}/output`, { ...values, isEstimated: estimated })}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
