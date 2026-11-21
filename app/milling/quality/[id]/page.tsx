"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import { useParams } from "next/navigation";
import { useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { FormError } from "@/components/milling/form-bits";
import { InspectForm } from "@/components/milling/inspection";
import { formatKg, formatWhen, MillStatus, useMillLookups } from "@/components/milling/mill-ui";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { useMillPost } from "@/components/milling/use-mill-post";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/api-client";

type Lot = { id: string; code: string; status: string; originType: string; producedAt: string; product: string; quantity: number; lastInspection: { outcome: string; inspectedAt: string } | null; waiting: string[] };

/** One lot's tests (QT-A2): inspect it against its spec, then release, hold or reject. */
export default function MillLotTestPage() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({ queryKey: ["milling", "lots", "one", id], queryFn: () => fetchJson<Lot[]>(`/api/milling/lots?id=${id}`) });
  const lot = query.data?.[0];
  return (
    <>
      <PageChrome title={lot?.code ?? "Lot"} />
      <div className="space-y-4 px-4 py-2">
        {query.isPending ? <Skeleton className="h-64 w-full" /> : !lot ? <EmptyState title="That lot is not here" body="Lots waiting for QC are under Quality." /> : <ul><LotRow lot={lot} /></ul>}
      </div>
    </>
  );
}

function LotRow({ lot }: { lot: Lot }) {
  const access = useMillAccess();
  const lookups = useMillLookups();
  const [open, setOpen] = useState(true);
  const [note, setNote] = useState("");
  const decide = useMillPost({ done: "Decision saved" });
  const point = lot.originType === "INTAKE" ? "INCOMING_MAIZE" : "FINISHED_PRODUCT";
  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono">{lot.code}</span>
        <span>{lot.product}</span>
        <span className="font-mono text-sm">{formatKg(lot.quantity)}</span>
        <MillStatus status={lot.status} />
        {lot.lastInspection ? (
          <span className="text-sm text-muted-foreground">
            inspected {formatWhen(lot.lastInspection.inspectedAt)}: <MillStatus status={lot.lastInspection.outcome} />
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">not inspected</span>
        )}
        {lot.waiting.length ? <span className="text-sm">waiting on {lot.waiting.join(", ")}</span> : null}
        <Button size="sm" variant="ghost" onClick={() => setOpen((value) => !value)}>
          {open ? "Close" : "Inspect and decide"}
        </Button>
      </div>
      {open ? (
        <div className="space-y-3">
          {access.can("qc.record") && lookups.data ? (
            <InspectForm endpoint={`/api/milling/lots/${lot.id}/inspect`} invalidate={["milling", "lots"]} specs={lookups.data.specs.filter((spec) => spec.point === point)} again={Boolean(lot.lastInspection)} />
          ) : null}
          {access.can("qc.decide") ? (
            <div className="max-w-xl space-y-2">
              <Textarea rows={2} aria-label={`Note for ${lot.code}`} placeholder="Note (needed to reject)" value={note} onChange={(event) => setNote(event.target.value)} />
              <FormError error={decide.error} />
              <div className="flex flex-wrap gap-2">
                {lot.status === "HOLD" ? <Button onClick={() => decide.post(`/api/milling/lots/${lot.id}/decide`, { decision: "RELEASE", note: note || null })}>Release</Button> : null}
                {lot.status === "AVAILABLE" ? (
                  <Button variant="secondary" onClick={() => decide.post(`/api/milling/lots/${lot.id}/decide`, { decision: "HOLD", note: note || null })}>
                    Put on hold
                  </Button>
                ) : null}
                <Button variant="destructive" onClick={() => decide.post(`/api/milling/lots/${lot.id}/decide`, { decision: "REJECT", note })}>
                  Reject and dispose
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
