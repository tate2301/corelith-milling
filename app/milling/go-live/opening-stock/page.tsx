"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import { useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { money } from "@/components/milling/customer-bits";
import { Field, FormError } from "@/components/milling/form-bits";
import { MillSelect, UNIT_SHORT } from "@/components/milling/mill-ui";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { useMillPost } from "@/components/milling/use-mill-post";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/api-client";

type Line = { id: string; productId: string; product: string; unit: string | null; stockLocationId: string; place: string; quantity: number; unitCost: number; value: number; posted: boolean };
type Opening = { id: string; code: string; status: string; asOf: string; postedAt: string | null; lines: Line[]; total: number; journal: Array<{ code: string; name: string; debit: number; credit: number }>; journalBalanced: boolean; warnings: string[] };
type View = { opening: Opening | null; places: Array<{ id: string; name: string }>; products: Array<{ id: string; name: string; unit: string; costPrice: number }> };

/** A unit cost to as many places as it has, up to four: maize is $0.285 a kilogram. */
const cost = (value: number) => "$" + value.toLocaleString("en-ZW", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const day = (value: string) => new Date(value).toLocaleDateString("en-ZW", { weekday: "short", day: "numeric", month: "short" });

/**
 * Opening stock (GL-B1, GL-B2): what the mill held on its first day, counted
 * at cost, beside the journal it will post. Posting asks once more, then puts
 * each count into a lot at its place and into Books. A wrong count after that
 * is corrected with a stock count, not by undoing this.
 */
export default function MillOpeningStockPage() {
  const access = useMillAccess();
  const query = useQuery({ queryKey: ["milling", "opening-stock"], queryFn: () => fetchJson<View>("/api/milling/go-live/opening") });
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string[] | null>(null);
  const remove = useMillPost();
  const post = useMillPost<{ failures: string[] }>({ done: "Opening stock posted", onDone: (answer) => (setConfirming(false), setResult(answer.failures)) });
  const opening = query.data?.opening;
  const draft = opening?.status === "DRAFT";
  const canCount = access.can("stock.count");
  const canPost = access.can("stock.adjust.approve");
  return (
    <>
      <PageChrome title="Opening stock" />
      <div className="space-y-5 px-4 py-2">
        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : !opening ? (
          <EmptyState title="Opening stock is not started" body="The stores controller counts it, item by item, in each store." />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_26rem]">
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold">Opening stock</h2>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <StatusChip status={draft ? "in_progress" : "passing"} label={draft ? "Started" : "Posted"} />
                    <span className="font-mono">{opening.code}</span>
                    <span>{day(opening.asOf)}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-2xl">{money(opening.total)}</div>
                  <div className="text-sm text-muted-foreground">
                    {opening.lines.length} {opening.lines.length === 1 ? "line" : "lines"}
                  </div>
                </div>
              </div>
              {draft && canCount ? <CountForm view={query.data!} /> : null}
              <FormError error={remove.error} />
              {!opening.lines.length ? (
                <p className="text-sm text-muted-foreground">Nothing counted yet.</p>
              ) : (
                <Table hideControlsWhenSinglePage>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Counted</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      {draft && canCount ? <TableHead /> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {opening.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell>
                          {line.product} <span className="text-sm text-muted-foreground">{line.place}</span>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {line.quantity.toLocaleString("en-ZW")} {UNIT_SHORT[line.unit ?? ""] ?? ""}
                        </TableCell>
                        <TableCell className="text-right font-mono">{cost(line.unitCost)}</TableCell>
                        <TableCell className="text-right font-mono">{money(line.value)}</TableCell>
                        {draft && canCount ? (
                          <TableCell className="text-right">
                            <Button size="sm" variant="ghost" onClick={() => remove.post("/api/milling/go-live/opening/lines", { action: "remove", lineId: line.id })}>
                              Take off
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 border-border font-medium">
                      <TableCell colSpan={3}>Opening stock</TableCell>
                      <TableCell className="text-right font-mono">{money(opening.total)}</TableCell>
                      {draft && canCount ? <TableCell /> : null}
                    </TableRow>
                  </TableBody>
                </Table>
              )}
              {result?.length ? (
                <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">
                  <p className="font-medium">The stock is in, but Books did not post every line:</p>
                  <ul className="list-disc pl-5">
                    {result.map((row) => (
                      <li key={row}>{row}</li>
                    ))}
                  </ul>
                  <p>Fix it in Books, then post again: only those lines are tried.</p>
                </div>
              ) : null}
            </div>
            <aside className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Posting</h3>
                <span className="text-sm text-muted-foreground">{draft ? "Not posted yet" : `Posted ${opening.postedAt ? day(opening.postedAt) : ""}`}</span>
              </div>
              {!opening.journal.length ? (
                <p className="text-sm text-muted-foreground">Counts with a cost show here as the journal they will post.</p>
              ) : (
                <Table hideControlsWhenSinglePage>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {opening.journal.map((row) => (
                      <TableRow key={row.code}>
                        <TableCell>
                          <span className="font-mono text-muted-foreground">{row.code}</span> {row.name}
                        </TableCell>
                        <TableCell className="text-right font-mono">{row.debit ? money(row.debit) : ""}</TableCell>
                        <TableCell className="text-right font-mono">{row.credit ? money(row.credit) : ""}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 border-border font-medium">
                      <TableCell>{opening.journalBalanced ? (draft ? "Will post" : "Posted") : "Does not balance"}</TableCell>
                      <TableCell className="text-right font-mono">{money(opening.journal.reduce((sum, row) => sum + row.debit, 0))}</TableCell>
                      <TableCell className="text-right font-mono">{money(opening.journal.reduce((sum, row) => sum + row.credit, 0))}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
              {opening.warnings.map((warning) => (
                <p key={warning} className="text-sm text-destructive">
                  {warning}
                </p>
              ))}
              {draft && canPost ? (
                <Button className="w-full" disabled={!opening.lines.length} onClick={() => setConfirming(true)}>
                  Post opening stock
                </Button>
              ) : draft ? (
                <p className="text-sm text-muted-foreground">Management posts it once the counts are in.</p>
              ) : null}
            </aside>
          </div>
        )}
        {confirming && opening ? (
          <Dialog open onOpenChange={(open) => (open ? undefined : setConfirming(false))}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Post opening stock</DialogTitle>
                <DialogDescription className="not-sr-only t-body-sm text-[var(--text-muted)]">
                  {money(opening.total)} goes on the books at {day(opening.asOf)}, as {opening.lines.length} {opening.lines.length === 1 ? "count" : "counts"} into stock. A wrong count is corrected with a stock count, not by undoing this.
                </DialogDescription>
              </DialogHeader>
              <FormError error={post.error} />
              <DialogFooter>
                <Button variant="secondary" onClick={() => setConfirming(false)}>
                  Keep editing
                </Button>
                <Button disabled={post.pending} onClick={() => post.post("/api/milling/go-live/opening/post", {})}>
                  Post opening stock
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    </>
  );
}

function CountForm({ view }: { view: View }) {
  const [productId, setProduct] = useState("");
  const [stockLocationId, setPlace] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setCost] = useState("");
  const save = useMillPost({ done: "Count saved", onDone: () => (setQuantity(""), setCost("")) });
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem_8rem_auto] sm:items-end">
        <Field id="os-item" label="Item">
          <MillSelect
            id="os-item"
            value={productId}
            onChange={(id) => (setProduct(id), setCost((current) => current || String(view.products.find((row) => row.id === id)?.costPrice || "")))}
            options={view.products.map((row) => ({ value: row.id, label: row.name }))}
          />
        </Field>
        <Field id="os-place" label="Where">
          <MillSelect id="os-place" value={stockLocationId} onChange={setPlace} options={view.places.map((row) => ({ value: row.id, label: row.name }))} />
        </Field>
        <Field id="os-qty" label="Counted">
          <Input id="os-qty" inputMode="decimal" className="font-mono" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </Field>
        <Field id="os-cost" label="Cost each, $">
          <Input id="os-cost" inputMode="decimal" className="font-mono" value={unitCost} onChange={(event) => setCost(event.target.value)} />
        </Field>
        <Button disabled={save.pending || !productId || !stockLocationId} onClick={() => save.post("/api/milling/go-live/opening/lines", { action: "set", productId, stockLocationId, quantity: Number(quantity), unitCost: Number(unitCost || 0) })}>
          Save count
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Counting an item again at the same place replaces its count.</p>
      <FormError error={save.error} />
    </div>
  );
}
