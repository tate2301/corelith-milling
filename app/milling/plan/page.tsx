"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { Field, FormError } from "@/components/milling/form-bits";
import { formatKg, MillSelect, MillStatus, useMillLookups } from "@/components/milling/mill-ui";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { useMillPost } from "@/components/milling/use-mill-post";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SectionTab, SectionTabs } from "@/components/ui/section-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/api-client";

type Order = { id: string; code: string; productionDate: string; shiftKind: string; status: string; maizeNeededKg: number; lines: Array<{ bags: number | null; kg: number }> };
type Needs = { outputKg: number; maizeKg: number; maizeAvailableKg: number; packaging: Array<{ name: string; needed: number; available: number }>; short: string[] };

const TABS = [
  { status: "DRAFT", label: "Drafts" },
  { status: "SUBMITTED", label: "To approve" },
  { status: "APPROVED", label: "Approved" },
  { status: "IN_PROGRESS", label: "In progress" },
  { status: "COMPLETED", label: "Completed" },
] as const;

/** Production orders: what to make, by day and shift. */
export default function MillPlanPage() {
  const params = useSearchParams();
  const router = useRouter();
  const status = params.get("status") ?? "SUBMITTED";
  const access = useMillAccess();
  const query = useQuery({ queryKey: ["milling", "orders", status], queryFn: () => fetchJson<{ rows: Order[]; counts: Record<string, number> }>(`/api/milling/orders?status=${status}`) });
  return (
    <>
      <PageChrome title="Plan" />
      <div className="space-y-4 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTabs label="Orders by status">
            {TABS.map((tab) => (
              <SectionTab key={tab.status} to={`/milling/plan?status=${tab.status}`} active={status === tab.status} count={query.data?.counts[tab.status]}>
                {tab.label}
              </SectionTab>
            ))}
          </SectionTabs>
          {access.can("plan.edit") ? <NewOrder onCreated={(id) => router.push(`/milling/plan/${id}`)} /> : null}
        </div>
        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : !query.data?.rows.length ? (
          <EmptyState title="No orders here" body="Plan what to make, then submit it for management to approve." />
        ) : (
          <Table hideControlsWhenSinglePage>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Day</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Maize</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.rows.map((order) => (
                <TableRow key={order.id} className="cursor-pointer" onClick={() => router.push(`/milling/plan/${order.id}`)}>
                  <TableCell className="whitespace-nowrap font-mono">{order.code}</TableCell>
                  <TableCell>{new Date(order.productionDate).toLocaleDateString("en-ZW", { weekday: "short", day: "numeric", month: "short" })}</TableCell>
                  <TableCell>{order.shiftKind === "DAY" ? "Day" : "Night"}</TableCell>
                  <TableCell className="text-right font-mono">{formatKg(order.lines.reduce((sum, line) => sum + Number(line.kg), 0))}</TableCell>
                  <TableCell className="text-right font-mono">{Number(order.maizeNeededKg) ? formatKg(Number(order.maizeNeededKg)) : "—"}</TableCell>
                  <TableCell>
                    <MillStatus status={order.status} />
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

type Line = { productId: string; amount: string };

function NewOrder({ onCreated }: { onCreated: (id: string) => void }) {
  const lookups = useMillLookups();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [kind, setKind] = useState("DAY");
  const [lines, setLines] = useState<Line[]>([{ productId: "", amount: "" }]);
  const [needs, setNeeds] = useState<Needs | null>(null);
  const create = useMillPost<{ id: string }>({ onDone: (order) => onCreated(order.id) });
  const products = (lookups.data?.products ?? []).filter((product) => product.unit === "BAG" || product.category === "Bulk product");
  const unitOf = (productId: string) => products.find((product) => product.id === productId)?.unit;
  const payload = lines
    .filter((line) => line.productId && Number(line.amount) > 0)
    .map((line) => (unitOf(line.productId) === "BAG" ? { productId: line.productId, bags: Number(line.amount) } : { productId: line.productId, kg: Number(line.amount) }));
  const key = JSON.stringify(payload);

  useEffect(() => {
    if (!open || !payload.length) return;
    const timer = setTimeout(() => {
      fetchJson<Needs>("/api/milling/requirements", { method: "POST", body: JSON.stringify({ lines: JSON.parse(key) }) })
        .then(setNeeds)
        .catch(() => setNeeds(null));
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, open]);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Plan production</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Plan production</DialogTitle>
            <DialogDescription>Packed products in bags, bulk ones in kg. The maize and packaging needed are worked out as you go.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field id="po-day" label="Day">
                <Input id="po-day" type="date" value={day} onChange={(event) => setDay(event.target.value)} />
              </Field>
              <Field id="po-shift" label="Shift">
                <MillSelect id="po-shift" value={kind} onChange={setKind} options={[{ value: "DAY", label: "Day" }, { value: "NIGHT", label: "Night" }]} />
              </Field>
            </div>
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-[1fr_7rem] gap-2">
                <MillSelect
                  value={line.productId}
                  onChange={(productId) => setLines((current) => current.map((entry, at) => (at === index ? { ...entry, productId } : entry)))}
                  placeholder="Product"
                  options={products.map((product) => ({ value: product.id, label: product.name }))}
                />
                <Input
                  aria-label={unitOf(line.productId) === "BAG" ? "Bags" : "Kg"}
                  placeholder={unitOf(line.productId) === "BAG" ? "bags" : "kg"}
                  inputMode="numeric"
                  className="font-mono"
                  value={line.amount}
                  onChange={(event) => setLines((current) => current.map((entry, at) => (at === index ? { ...entry, amount: event.target.value } : entry)))}
                />
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setLines((current) => [...current, { productId: "", amount: "" }])}>
              Add a product
            </Button>
            {needs && payload.length ? (
              <div className="rounded-md border p-3 text-sm">
                <div>
                  Maize needed <span className="font-mono">{formatKg(needs.maizeKg)}</span>, free <span className="font-mono">{formatKg(needs.maizeAvailableKg)}</span>
                </div>
                {needs.packaging.map((row) => (
                  <div key={row.name}>
                    {row.name}: <span className="font-mono">{row.needed}</span> needed, <span className="font-mono">{row.available}</span> free
                  </div>
                ))}
                {needs.short.length ? <div className="mt-1 text-[var(--status-warning-fg,inherit)]">Short of {needs.short.join("; ")}.</div> : null}
              </div>
            ) : null}
            <FormError error={create.error} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={create.pending || !payload.length} onClick={() => create.post("/api/milling/orders", { productionDate: day, shiftKind: kind, lines: payload })}>
              Save draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
