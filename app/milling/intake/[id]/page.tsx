"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { formatKg, formatWhen, MillSelect, MillStatus, useMillLookups, type MillLookups } from "@/components/milling/mill-ui";
import { InspectForm, InspectionResults } from "@/components/milling/inspection";
import { RecordHistory } from "@/components/milling/record-history";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionTab, SectionTabs } from "@/components/ui/section-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { fetchJson, getApiErrorMessage } from "@/lib/api-client";

type Detail = {
  intake: {
    id: string;
    code: string;
    status: string;
    supplierName: string;
    vehicleReg: string | null;
    driverName: string | null;
    deliveryRef: string | null;
    variety: string | null;
    weighMethod: string;
    bags: number | null;
    bagKg: number | null;
    grossKg: number | null;
    tareKg: number | null;
    netKg: number;
    ticketNumber: string | null;
    weightStatus: string;
    binLocationId: string | null;
    receivedAt: string;
    decisionNote: string | null;
    notes: string | null;
  };
  productName: string | null;
  bin: { code: string; name: string } | null;
  lot: { id: string; code: string; status: string; onHand: number } | null;
  inspections: Array<{
    id: string;
    outcome: string;
    inspectedAt: string;
    results: Array<{ id: string; specName: string; specVersion: number; method: string; value: number | null; passed: boolean | null; note: string | null }>;
  }>;
  exceptions: Array<{ id: string; code: string; title: string; status: string; decision: string | null; decisionNote: string | null }>;
};


/** One delivery: what came in, QC, the decision, and its history. */
export default function IntakeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<"delivery" | "history">("delivery");
  const query = useQuery({ queryKey: ["milling", "intake", id], queryFn: () => fetchJson<Detail>(`/api/milling/intakes/${id}`) });
  const lookups = useMillLookups();

  if (query.isPending || lookups.isPending) return <Skeleton className="m-4 h-96" />;
  if (query.isError || !query.data) {
    return (
      <Alert variant="destructive" className="m-4">
        <AlertDescription>{getApiErrorMessage(query.error)}</AlertDescription>
      </Alert>
    );
  }
  const { intake } = query.data;
  return (
    <>
      <PageChrome title={`Delivery ${intake.code}`} />
      <div className="space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <MillStatus status={intake.status} />
          <span className="text-sm text-muted-foreground">
            {intake.supplierName} · received {formatWhen(intake.receivedAt)}
          </span>
        </div>
        <SectionTabs label="Delivery sections">
          <SectionTab onClick={() => setTab("delivery")} active={tab === "delivery"}>
            Delivery and QC
          </SectionTab>
          <SectionTab onClick={() => setTab("history")} active={tab === "history"}>
            History
          </SectionTab>
        </SectionTabs>
        {tab === "history" ? (
          <RecordHistory entityType="MillingIntake" entityId={intake.id} />
        ) : (
          <DeliveryAndQc detail={query.data} lookups={lookups.data!} />
        )}
      </div>
    </>
  );
}

function DeliveryAndQc({ detail, lookups }: { detail: Detail; lookups: MillLookups }) {
  const { intake, lot, inspections, exceptions } = detail;
  const access = useMillAccess();
  const open = ["AWAITING_QC", "HELD"].includes(intake.status);
  const openExceptions = exceptions.filter((exception) => exception.status === "OPEN");
  const weight =
    intake.weighMethod === "BAG_COUNT"
      ? `${intake.bags} bags × ${intake.bagKg} kg`
      : intake.weighMethod === "EXTERNAL_TICKET"
        ? `Ticket ${intake.ticketNumber}${intake.grossKg ? ` · ${formatKg(intake.grossKg)} gross, ${formatKg(intake.tareKg)} tare` : ""}`
        : "Supplier's declared weight";

  return (
    <div className="space-y-8">
      <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
        <Item label="Grain">{detail.productName ?? "—"}{intake.variety ? ` · ${intake.variety}` : ""}</Item>
        <Item label="Vehicle and driver">{[intake.vehicleReg, intake.driverName].filter(Boolean).join(" · ") || "—"}</Item>
        <Item label="Delivery note">{intake.deliveryRef ?? "—"}</Item>
        <Item label="Net weight">
          <span className="font-mono">{formatKg(intake.netKg)}</span> <MillStatus status={intake.weightStatus} />
        </Item>
        <Item label="Weighed by">{weight}</Item>
        <Item label="Lot">
          {lot ? (
            <Link className="underline" href={`/milling/stock?lot=${lot.id}`}>
              {lot.code}
            </Link>
          ) : (
            "Not received yet"
          )}
          {lot ? <> · <MillStatus status={lot.status} /></> : null}
          {detail.bin ? ` · in ${detail.bin.code}` : ""}
        </Item>
      </dl>

      {intake.weightStatus === "PROVISIONAL" && access.can("intake.record") && !["REJECTED", "CANCELLED"].includes(intake.status) ? (
        <ConfirmWeight intakeId={intake.id} />
      ) : null}

      {openExceptions.length ? (
        <Alert variant="warning">
          <AlertTitle>Waiting for a decision</AlertTitle>
          <AlertDescription>
            {openExceptions.map((exception) => `${exception.code}: ${exception.title}`).join("; ")}.{" "}
            <Link className="underline" href="/milling/exceptions">
              Open the exceptions queue
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Quality</h2>
        {inspections[0] ? <InspectionResults inspection={inspections[0]} /> : <p className="text-sm text-muted-foreground">Not inspected yet.</p>}
        {open && access.can("qc.record") ? (
          <InspectForm endpoint={`/api/milling/intakes/${intake.id}/inspect`} invalidate={["milling", "intake", intake.id]} specs={lookups.specs.filter((spec) => spec.point === "INCOMING_MAIZE")} again={inspections.length > 0} />
        ) : null}
      </section>

      {open && access.can("qc.decide") ? <Decide detail={detail} lookups={lookups} /> : null}
      {intake.decisionNote ? <p className="text-sm text-muted-foreground">Decision note: {intake.decisionNote}</p> : null}
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Decide({ detail, lookups }: { detail: Detail; lookups: MillLookups }) {
  const { intake } = detail;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [bin, setBin] = useState(intake.binLocationId ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: (decision: "ACCEPT" | "HOLD" | "REJECT") =>
      fetchJson(`/api/milling/intakes/${intake.id}/decide`, { method: "POST", body: JSON.stringify({ decision, binLocationId: bin || null, note: note || null }) }),
    onSuccess: () => {
      toast({ title: "Decision saved", variant: "success" });
      void queryClient.invalidateQueries({ queryKey: ["milling"] });
    },
    onError: (failure) => setError(getApiErrorMessage(failure)),
  });
  const stores = lookups.locations.filter((location) => ["STORE", "BIN", "SILO", "DOCK"].includes(location.kind));
  return (
    <section className="max-w-xl space-y-3">
      <h2 className="text-base font-semibold">Decision</h2>
      <div className="space-y-1">
        <Label htmlFor="bin">Goes into</Label>
        <MillSelect id="bin" value={bin} onChange={setBin} options={stores.map((location) => ({ value: location.id, label: `${location.code} · ${location.name}` }))} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="note">Note</Label>
        <Textarea id="note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={decide.isPending} onClick={() => (setError(null), decide.mutate("ACCEPT"))}>
          Accept
        </Button>
        {intake.status === "AWAITING_QC" ? (
          <Button variant="secondary" disabled={decide.isPending} onClick={() => (setError(null), decide.mutate("HOLD"))}>
            Hold
          </Button>
        ) : null}
        <Button variant="destructive" disabled={decide.isPending} onClick={() => (setError(null), decide.mutate("REJECT"))}>
          Reject
        </Button>
      </div>
    </section>
  );
}

function ConfirmWeight({ intakeId }: { intakeId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({ ticketNumber: "", grossKg: "", tareKg: "", reason: "" });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => fetchJson(`/api/milling/intakes/${intakeId}/confirm-weight`, { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["milling"] });
    },
    onError: (failure) => setError(getApiErrorMessage(failure)),
  });
  const field = (key: keyof typeof values, label: string, mono = false) => (
    <div className="space-y-1">
      <Label htmlFor={`cw-${key}`}>{label}</Label>
      <Input id={`cw-${key}`} className={mono ? "font-mono" : undefined} inputMode={mono ? "decimal" : undefined} value={values[key]} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} />
    </div>
  );
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Confirm the weight with a ticket
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm the weight</DialogTitle>
            <DialogDescription>The first figure is kept. The lot is adjusted by the difference.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {field("ticketNumber", "Ticket number")}
            <div className="grid grid-cols-2 gap-3">
              {field("grossKg", "Gross kg", true)}
              {field("tareKg", "Tare kg", true)}
            </div>
            {field("reason", "Where the ticket is from")}
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={save.isPending} onClick={() => (setError(null), save.mutate())}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
