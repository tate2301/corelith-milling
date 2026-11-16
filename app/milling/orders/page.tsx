"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { Field, FormError } from "@/components/milling/form-bits";
import { formatKg, formatWhen, MillSelect, MillStatus, useMillLookups } from "@/components/milling/mill-ui";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { useMillPost } from "@/components/milling/use-mill-post";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SectionTab, SectionTabs } from "@/components/ui/section-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/api-client";

type Order = { id: string; code: string; status: string; customer: string; destination: string | null; requiredDate: string | null; createdAt: string; bags: number; kg: number; lines: Array<{ id: string; product: string; bags: number }> };

const TABS = [
  { status: "DRAFT", label: "Drafts" },
  { status: "CONFIRMED", label: "Confirmed" },
  { status: "IN_DELIVERY", label: "On a delivery" },
  { status: "DELIVERED", label: "Delivered" },
] as const;

/** Customer orders for packed product. Confirming one reserves its bags. */
export default function MillOrdersPage() {
  const params = useSearchParams();
  const status = params.get("status") ?? "CONFIRMED";
  const access = useMillAccess();
  const act = useMillPost({ done: "Saved" });
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["milling", "customer-orders", status], queryFn: () => fetchJson<{ rows: Order[]; counts: Record<string, number> }>(`/api/milling/customer-orders?status=${status}`) });
  return (
    <>
      <PageChrome title="Orders" />
      <div className="space-y-4 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTabs label="Orders by status">
            {TABS.map((tab) => (
              <SectionTab key={tab.status} to={`/milling/orders?status=${tab.status}`} active={status === tab.status} count={query.data?.counts[tab.status]}>
                {tab.label}
              </SectionTab>
            ))}
          </SectionTabs>
          {access.can("order.manage") ? <NewOrder /> : null}
        </div>
        <FormError error={act.error} />
        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : !query.data?.rows.length ? (
          <EmptyState title="No orders here" body="Take an order, then confirm it to reserve its bags." />
        ) : (
          <Table hideControlsWhenSinglePage>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Wanted</TableHead>
                <TableHead className="text-right">Bags</TableHead>
                <TableHead className="text-right">Weight</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.rows.map((order) => (
                <Fragment key={order.id}>
                  <TableRow className="cursor-pointer" onClick={() => setOpen(open === order.id ? null : order.id)}>
                    <TableCell className="font-mono">{order.code}</TableCell>
                    <TableCell>{order.customer}</TableCell>
                    <TableCell>{order.destination ?? "Collected"}</TableCell>
                    <TableCell>{order.requiredDate ? new Date(order.requiredDate).toLocaleDateString("en-ZW", { day: "numeric", month: "short" }) : "—"}</TableCell>
                    <TableCell className="text-right font-mono">{order.bags}</TableCell>
                    <TableCell className="text-right font-mono">{formatKg(order.kg)}</TableCell>
                    <TableCell>
                      <MillStatus status={order.status} />
                    </TableCell>
                    <TableCell className="space-x-2 text-right" onClick={(event) => event.stopPropagation()}>
                      {order.status === "DRAFT" && access.can("order.manage") ? (
                        <Button size="sm" onClick={() => act.post(`/api/milling/customer-orders/${order.id}/confirm`)}>
                          Confirm
                        </Button>
                      ) : null}
                      {["DRAFT", "CONFIRMED"].includes(order.status) && access.can("order.manage") ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const reason = window.prompt(`Why cancel ${order.code}?`);
                            if (reason) act.post(`/api/milling/customer-orders/${order.id}/cancel`, { reason });
                          }}
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                  {open === order.id
                    ? order.lines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell />
                          <TableCell colSpan={3}>{line.product}</TableCell>
                          <TableCell className="text-right font-mono">{line.bags}</TableCell>
                          <TableCell colSpan={3} className="text-xs text-muted-foreground">
                            taken {formatWhen(order.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))
                    : null}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-sm text-muted-foreground">
          Customers are kept under <Link className="underline" href="/crm/customers">Customers</Link>.
        </p>
      </div>
    </>
  );
}

function NewOrder() {
  const lookups = useMillLookups();
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [lines, setLines] = useState([{ productId: "", bags: "" }]);
  const save = useMillPost({ done: "Order saved", onDone: () => (setOpen(false), setLines([{ productId: "", bags: "" }])) });
  const packed = (lookups.data?.products ?? []).filter((product) => product.unit === "BAG");
  return (
    <>
      <Button onClick={() => setOpen(true)}>Take an order</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Take an order</DialogTitle>
            <DialogDescription>Saved as a draft. Confirm it to reserve the bags, oldest first.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field id="co-customer" label="Customer">
              <MillSelect id="co-customer" value={customerId} onChange={setCustomerId} options={(lookups.data?.customers ?? []).map((customer) => ({ value: customer.id, label: customer.name }))} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="co-dest" label="Deliver to">
                <MillSelect id="co-dest" value={destinationId} onChange={setDestinationId} allowNone placeholder="Collected" options={(lookups.data?.destinations ?? []).map((destination) => ({ value: destination.id, label: destination.name }))} />
              </Field>
              <Field id="co-date" label="Wanted by">
                <Input id="co-date" type="date" value={requiredDate} onChange={(event) => setRequiredDate(event.target.value)} />
              </Field>
            </div>
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-[1fr_7rem] gap-2">
                <MillSelect value={line.productId} onChange={(productId) => setLines((current) => current.map((entry, at) => (at === index ? { ...entry, productId } : entry)))} placeholder="Product" options={packed.map((product) => ({ value: product.id, label: product.name }))} />
                <Input aria-label="Bags" placeholder="bags" inputMode="numeric" className="font-mono" value={line.bags} onChange={(event) => setLines((current) => current.map((entry, at) => (at === index ? { ...entry, bags: event.target.value } : entry)))} />
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setLines((current) => [...current, { productId: "", bags: "" }])}>
              Add a product
            </Button>
            <FormError error={save.error} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={save.pending}
              onClick={() =>
                save.post("/api/milling/customer-orders", {
                  customerId,
                  destinationId: destinationId || null,
                  requiredDate: requiredDate || null,
                  lines: lines.filter((line) => line.productId && Number(line.bags) > 0),
                })
              }
            >
              Save draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
