"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { formatQty, formatWhen, MillSelect, MillStatus, useMillLookups } from "@/components/milling/mill-ui";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionTab, SectionTabs } from "@/components/ui/section-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson, getApiErrorMessage } from "@/lib/api-client";

type Lot = {
  id: string;
  code: string;
  status: string;
  producedAt: string;
  balances: Array<{ stockLocationId: string; location: string; quantity: number; reserved: number }>;
};
type ProductStock = {
  id: string;
  name: string;
  unit: string;
  unitLabel: string | null;
  category: string | null;
  netWeightKg: number | null;
  onHand: number;
  available: number;
  onHold: number;
  notInALot: number;
  lots: Lot[];
};

const TABS = [
  { key: "onhand", label: "On hand" },
  { key: "movements", label: "Movements" },
  { key: "counts", label: "Counts" },
] as const;

/** The mill's one stock ledger: what is here by product, lot and bin; how it moved; how it was counted. */
export default function MillStockPage() {
  const params = useSearchParams();
  const tab = params.get("tab") ?? "onhand";
  const access = useMillAccess();
  return (
    <>
      <PageChrome title="Stock" />
      <div className="space-y-4 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTabs label="Stock views">
            {TABS.map((entry) => (
              <SectionTab key={entry.key} to={`/milling/stock?tab=${entry.key}`} active={tab === entry.key}>
                {entry.label}
              </SectionTab>
            ))}
          </SectionTabs>
          <div className="flex flex-wrap gap-2">
            {access.can("stock.count") ? (
              <Button variant="secondary" asChild>
                <Link href="/milling/stock/count">Count a location</Link>
              </Button>
            ) : null}
            {access.can("stock.adjust.approve") ? <OpeningStock /> : null}
          </div>
        </div>
        {tab === "movements" ? <Movements lotId={params.get("lot")} /> : tab === "counts" ? <Counts /> : <OnHand focusLot={params.get("lot")} />}
      </div>
    </>
  );
}

function OnHand({ focusLot }: { focusLot: string | null }) {
  const access = useMillAccess();
  const query = useQuery({ queryKey: ["milling", "stock"], queryFn: () => fetchJson<{ products: ProductStock[] }>("/api/milling/stock") });
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [moving, setMoving] = useState<{ lot: Lot; product: ProductStock } | null>(null);

  if (query.isLoading) return <Skeleton className="h-64 w-full" />;
  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{getApiErrorMessage(query.error)}</AlertDescription>
      </Alert>
    );
  }
  const products = query.data?.products ?? [];
  if (!products.length) return <EmptyState title="No stock at the mill yet" body="Accepted deliveries and opening stock appear here." />;
  const isOpen = (product: ProductStock) => open.has(product.id) || product.lots.some((lot) => lot.id === focusLot);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">On hand</TableHead>
            <TableHead className="text-right">Available</TableHead>
            <TableHead className="text-right">On hold</TableHead>
            <TableHead className="text-right">Not in a lot</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => (
            <Fragment key={product.id}>
              <TableRow
                className="cursor-pointer"
                aria-expanded={isOpen(product)}
                onClick={() =>
                  setOpen((current) => {
                    const next = new Set(current);
                    if (next.has(product.id)) next.delete(product.id);
                    else next.add(product.id);
                    return next;
                  })
                }
              >
                <TableCell>
                  <span className="mr-2 text-muted-foreground">{isOpen(product) ? "▾" : "▸"}</span>
                  {product.name}
                  <span className="text-xs text-muted-foreground"> · {product.lots.length} lot{product.lots.length === 1 ? "" : "s"}</span>
                </TableCell>
                <TableCell className="text-right font-mono">{formatQty(product.onHand, product.unit, product.unitLabel)}</TableCell>
                <TableCell className="text-right font-mono">{formatQty(product.available, product.unit, product.unitLabel)}</TableCell>
                <TableCell className="text-right font-mono">{product.onHold ? formatQty(product.onHold, product.unit, product.unitLabel) : "—"}</TableCell>
                <TableCell className="text-right font-mono">{product.notInALot ? formatQty(product.notInALot, product.unit, product.unitLabel) : "—"}</TableCell>
              </TableRow>
              {isOpen(product)
                ? product.lots.flatMap((lot) =>
                    lot.balances.map((balance) => (
                      <TableRow key={`${lot.id}-${balance.stockLocationId}`} className={lot.id === focusLot ? "bg-muted" : undefined}>
                        <TableCell className="pl-10">
                          <span className="font-mono">{lot.code}</span> · {balance.location} · <MillStatus status={lot.status} />
                          <span className="text-xs text-muted-foreground"> · {formatWhen(lot.producedAt)}</span>
                        </TableCell>
                        <TableCell className="text-right font-mono">{formatQty(balance.quantity, product.unit, product.unitLabel)}</TableCell>
                        <TableCell className="text-right font-mono">
                          {balance.reserved ? `${formatQty(balance.reserved, product.unit, product.unitLabel)} promised` : ""}
                        </TableCell>
                        <TableCell colSpan={2} className="text-right">
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/milling/stock?tab=movements&lot=${lot.id}`}>Movements</Link>
                          </Button>
                          {access.can("stock.move") ? (
                            <Button variant="ghost" size="sm" onClick={() => setMoving({ lot: { ...lot, balances: [balance] }, product })}>
                              Move
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    )),
                  )
                : null}
            </Fragment>
          ))}
        </TableBody>
      </Table>
      {moving ? <MoveDialog lot={moving.lot} product={moving.product} onClose={() => setMoving(null)} /> : null}
    </>
  );
}

function MoveDialog({ lot, product, onClose }: { lot: Lot; product: ProductStock; onClose: () => void }) {
  const lookups = useMillLookups();
  const queryClient = useQueryClient();
  const from = lot.balances[0];
  const [to, setTo] = useState("");
  const [quantity, setQuantity] = useState(String(from.quantity - from.reserved));
  const [error, setError] = useState<string | null>(null);
  const move = useMutation({
    mutationFn: () =>
      fetchJson("/api/milling/stock/move", { method: "POST", body: JSON.stringify({ lotId: lot.id, fromLocationId: from.stockLocationId, toLocationId: to, quantity }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["milling", "stock"] });
      onClose();
    },
    onError: (failure) => setError(getApiErrorMessage(failure)),
  });
  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move {lot.code}</DialogTitle>
          <DialogDescription>
            From {from.location}, where {formatQty(from.quantity - from.reserved, product.unit, product.unitLabel)} is free.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="move-to">To</Label>
            <MillSelect
              id="move-to"
              value={to}
              onChange={setTo}
              options={(lookups.data?.locations ?? []).filter((location) => location.id !== from.stockLocationId).map((location) => ({ value: location.id, label: `${location.code} · ${location.name}` }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="move-qty">How much</Label>
            <Input id="move-qty" className="font-mono" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={move.isPending || !to} onClick={() => (setError(null), move.mutate())}>
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const REASON_LABEL: Record<string, string> = {
  INTAKE_RECEIPT: "Received at intake",
  OPENING: "Opening stock",
  BIN_MOVE: "Moved",
  PRODUCTION_ISSUE: "Into production",
  PRODUCTION_OUTPUT: "From production",
  PACK_ISSUE: "Into packing",
  PACK_OUTPUT: "Packed",
  PACK_RETURN: "Back from packing",
  DESPATCH: "Despatched",
  DELIVERY_RETURN: "Returned by a customer",
  QC_DISPOSAL: "Disposed after QC",
  RETURN_TO_SUPPLIER: "Returned to supplier",
  COUNT_ADJUSTMENT: "Count difference",
  WEIGHT_CORRECTION: "Weight confirmed",
};

function Movements({ lotId }: { lotId: string | null }) {
  const query = useQuery({
    queryKey: ["milling", "stock", "movements", lotId],
    queryFn: () =>
      fetchJson<Array<{ id: string; at: string; lot: string; product: string; from: string | null; to: string | null; quantity: number; reason: string; isEstimated: boolean; by: string | null }>>(
        `/api/milling/stock/movements${lotId ? `?lotId=${lotId}` : ""}`,
      ),
  });
  if (query.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!query.data?.length) return <EmptyState title="No movements yet" body="Every receipt, move, issue and count appears here." />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Lot</TableHead>
          <TableHead>What</TableHead>
          <TableHead>From → to</TableHead>
          <TableHead className="text-right">Quantity</TableHead>
          <TableHead>By</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {query.data.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{formatWhen(row.at)}</TableCell>
            <TableCell>
              <span className="font-mono">{row.lot}</span> <span className="text-xs text-muted-foreground">{row.product}</span>
            </TableCell>
            <TableCell>{REASON_LABEL[row.reason] ?? row.reason}</TableCell>
            <TableCell>{[row.from ?? "in", row.to ?? "out"].join(" → ")}</TableCell>
            <TableCell className="text-right font-mono">
              {row.quantity}
              {row.isEstimated ? <span className="text-xs text-muted-foreground"> est.</span> : null}
            </TableCell>
            <TableCell>{row.by ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Counts() {
  const query = useQuery({
    queryKey: ["milling", "stock", "counts"],
    queryFn: () =>
      fetchJson<Array<{ id: string; code: string; status: string; countedAt: string; location: { code: string; name: string } | null; lines: Array<{ expected: number; counted: number }> }>>("/api/milling/stock/counts"),
  });
  if (query.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!query.data?.length) return <EmptyState title="No counts yet" body="Count a location to check the ledger against what is there." />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Count</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>When</TableHead>
          <TableHead className="text-right">Lots</TableHead>
          <TableHead className="text-right">Lots off</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {query.data.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-mono">{row.code}</TableCell>
            <TableCell>{row.location ? `${row.location.code} · ${row.location.name}` : "—"}</TableCell>
            <TableCell>{formatWhen(row.countedAt)}</TableCell>
            <TableCell className="text-right font-mono">{row.lines.length}</TableCell>
            <TableCell className="text-right font-mono">{row.lines.filter((line) => line.counted !== line.expected).length}</TableCell>
            <TableCell>
              <MillStatus status={row.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function OpeningStock() {
  const lookups = useMillLookups();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({ productId: "", stockLocationId: "", quantity: "", unitCost: "" });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => fetchJson("/api/milling/stock/opening", { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => {
      setValues((current) => ({ ...current, productId: "", quantity: "", unitCost: "" }));
      void queryClient.invalidateQueries({ queryKey: ["milling", "stock"] });
    },
    onError: (failure) => setError(getApiErrorMessage(failure)),
  });
  const product = lookups.data?.products.find((entry) => entry.id === values.productId);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Opening stock
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Opening stock</DialogTitle>
            <DialogDescription>What the mill starts with on go-live day, product by product and place by place. Each entry becomes an available lot.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <MillSelect value={values.productId} onChange={(productId) => setValues((current) => ({ ...current, productId }))} placeholder="Product" options={(lookups.data?.products ?? []).map((entry) => ({ value: entry.id, label: entry.name }))} />
            <MillSelect value={values.stockLocationId} onChange={(stockLocationId) => setValues((current) => ({ ...current, stockLocationId }))} placeholder="Where" options={(lookups.data?.locations ?? []).map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))} />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="opening-qty">Quantity{product ? ` (${product.unit === "KILOGRAM" ? "kg" : product.unit === "BAG" ? "bags" : product.unitLabel ?? "each"})` : ""}</Label>
                <Input id="opening-qty" className="font-mono" inputMode="decimal" value={values.quantity} onChange={(event) => setValues((current) => ({ ...current, quantity: event.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="opening-cost">Cost of one</Label>
                <Input id="opening-cost" className="font-mono" inputMode="decimal" value={values.unitCost} onChange={(event) => setValues((current) => ({ ...current, unitCost: event.target.value }))} />
              </div>
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Done
            </Button>
            <Button disabled={save.isPending} onClick={() => (setError(null), save.mutate())}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
