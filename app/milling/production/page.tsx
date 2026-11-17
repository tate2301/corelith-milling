"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { Field, FormError } from "@/components/milling/form-bits";
import { formatKg, formatWhen, MillSelect, MillStatus } from "@/components/milling/mill-ui";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { useMillPost } from "@/components/milling/use-mill-post";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionTab, SectionTabs } from "@/components/ui/section-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/api-client";

type Batch = { id: string; code: string; status: string; startedAt: string; maizeIssuedKg: number; outputKg: number; stagesDone: number; variancePct: number | null };

/** Batches running and done. */
export default function MillProductionPage() {
  const params = useSearchParams();
  const router = useRouter();
  const status = params.get("status") ?? "ACTIVE";
  const access = useMillAccess();
  const query = useQuery({ queryKey: ["milling", "batches", status], queryFn: () => fetchJson<Batch[]>(`/api/milling/batches?status=${status}`) });
  return (
    <>
      <PageChrome title="Production" />
      <div className="space-y-4 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTabs label="Batches by status">
            <SectionTab to="/milling/production" active={status === "ACTIVE"}>
              Running
            </SectionTab>
            <SectionTab to="/milling/production?status=COMPLETED" active={status === "COMPLETED"}>
              Completed
            </SectionTab>
          </SectionTabs>
          {access.can("batch.run") ? <StartBatch onStarted={(id) => router.push(`/milling/production/${id}`)} /> : null}
        </div>
        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : !query.data?.length ? (
          <EmptyState title={status === "ACTIVE" ? "No batch is running" : "No completed batches yet"} body="Start a batch on an open shift, from an approved order." />
        ) : (
          <Table hideControlsWhenSinglePage>
            <TableHeader>
              <TableRow>
                <TableHead>Batch</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="text-right">Maize in</TableHead>
                <TableHead className="text-right">Product out</TableHead>
                <TableHead className="text-right">Stages</TableHead>
                <TableHead className="text-right">Unaccounted</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((batch) => (
                <TableRow key={batch.id} className="cursor-pointer" onClick={() => router.push(`/milling/production/${batch.id}`)}>
                  <TableCell className="whitespace-nowrap font-mono">{batch.code}</TableCell>
                  <TableCell>{formatWhen(batch.startedAt)}</TableCell>
                  <TableCell className="text-right font-mono">{formatKg(Number(batch.maizeIssuedKg))}</TableCell>
                  <TableCell className="text-right font-mono">{formatKg(batch.outputKg)}</TableCell>
                  <TableCell className="text-right font-mono">{batch.stagesDone}</TableCell>
                  <TableCell className="text-right font-mono">{batch.variancePct === null ? "—" : `${Number(batch.variancePct).toFixed(1)}%`}</TableCell>
                  <TableCell>
                    <MillStatus status={batch.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}

function StartBatch({ onStarted }: { onStarted: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const orders = useQuery({ queryKey: ["milling", "orders", "startable"], queryFn: () => fetchJson<{ rows: Array<{ id: string; code: string; status: string }> }>("/api/milling/orders"), enabled: open });
  const shifts = useQuery({ queryKey: ["milling", "shifts", "OPEN"], queryFn: () => fetchJson<Array<{ id: string; code: string }>>("/api/milling/shifts?status=OPEN"), enabled: open });
  const [orderId, setOrderId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const start = useMillPost<{ id: string }>({ onDone: (batch) => onStarted(batch.id) });
  return (
    <>
      <Button onClick={() => setOpen(true)}>Start a batch</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start a batch</DialogTitle>
            <DialogDescription>Maize issued to it comes from the order&apos;s reserved lots first.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field id="batch-order" label="Production order">
              <MillSelect id="batch-order" value={orderId} onChange={setOrderId} allowNone options={(orders.data?.rows ?? []).filter((order) => ["APPROVED", "IN_PROGRESS"].includes(order.status)).map((order) => ({ value: order.id, label: order.code }))} />
            </Field>
            <Field id="batch-shift" label="Shift">
              <MillSelect id="batch-shift" value={shiftId} onChange={setShiftId} allowNone options={(shifts.data ?? []).map((shift) => ({ value: shift.id, label: shift.code }))} />
            </Field>
            <FormError error={start.error} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={start.pending} onClick={() => start.post("/api/milling/batches", { orderId: orderId || null, shiftId: shiftId || null })}>
              Start
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
