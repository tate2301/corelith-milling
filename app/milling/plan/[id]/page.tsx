"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { FormError, Stat } from "@/components/milling/form-bits";
import { formatKg, formatWhen, MillStatus } from "@/components/milling/mill-ui";
import { RecordHistory } from "@/components/milling/record-history";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { useMillPost } from "@/components/milling/use-mill-post";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SectionTab, SectionTabs } from "@/components/ui/section-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/api-client";

type Detail = {
  order: { id: string; code: string; status: string; productionDate: string; shiftKind: string; approvedShort: boolean; notes: string | null; lines: Array<{ id: string; productName: string; bags: number | null; kg: number }> };
  needs: { outputKg: number; maizeKg: number; maizeAvailableKg: number; packaging: Array<{ name: string; needed: number; available: number }>; short: string[] };
  reservedKg: number;
  batches: Array<{ id: string; code: string; status: string; startedAt: string; maizeIssuedKg: number }>;
};

/** One production order: what it makes, what it needs, approval, and its batches. */
export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<"order" | "history">("order");
  const access = useMillAccess();
  const query = useQuery({ queryKey: ["milling", "order", id], queryFn: () => fetchJson<Detail>(`/api/milling/orders/${id}`) });
  const action = useMillPost({ done: "Saved" });
  const [reason, setReason] = useState("");
  if (query.isLoading || !query.data) return <Skeleton className="m-4 h-96" />;
  const { order, needs } = query.data;
  const act = (name: string, body?: unknown) => action.post(`/api/milling/orders/${id}/${name}`, body);

  return (
    <>
      <PageChrome title={`Order ${order.code}`} />
      <div className="space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <MillStatus status={order.status} />
          <span className="text-sm text-muted-foreground">
            {new Date(order.productionDate).toLocaleDateString("en-ZW", { weekday: "long", day: "numeric", month: "long" })} · {order.shiftKind === "DAY" ? "day" : "night"} shift
          </span>
        </div>
        <SectionTabs label="Order sections">
          <SectionTab onClick={() => setTab("order")} active={tab === "order"}>
            Order
          </SectionTab>
          <SectionTab onClick={() => setTab("history")} active={tab === "history"}>
            History
          </SectionTab>
        </SectionTabs>
        {tab === "history" ? (
          <RecordHistory entityType="MillingProductionOrder" entityId={order.id} />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Bags</TableHead>
                  <TableHead className="text-right">Weight</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>{line.productName}</TableCell>
                    <TableCell className="text-right font-mono">{line.bags ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{formatKg(Number(line.kg))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <dl className="grid gap-4 text-sm sm:grid-cols-4">
              <Stat label="Maize needed">
                <span className="font-mono">{formatKg(needs.maizeKg)}</span>
              </Stat>
              <Stat label="Maize free now">
                <span className="font-mono">{formatKg(needs.maizeAvailableKg)}</span>
              </Stat>
              <Stat label="Reserved for this order">
                <span className="font-mono">{formatKg(query.data.reservedKg)}</span>
              </Stat>
              {needs.packaging.map((row) => (
                <Stat key={row.name} label={row.name}>
                  <span className="font-mono">
                    {row.needed} needed · {row.available} free
                  </span>
                </Stat>
              ))}
            </dl>
            {needs.short.length && ["DRAFT", "SUBMITTED"].includes(order.status) ? (
              <Alert variant="warning">
                <AlertTitle>Materials are short</AlertTitle>
                <AlertDescription>Short of {needs.short.join("; ")}. Management can approve anyway, with a reason.</AlertDescription>
              </Alert>
            ) : null}
            {order.approvedShort ? <p className="text-sm text-muted-foreground">Approved although materials were short.</p> : null}

            <div className="max-w-xl space-y-2">
              {order.status === "SUBMITTED" && access.can("plan.approve") ? (
                <Textarea rows={2} aria-label="Reason" placeholder={needs.short.length ? "Why approve although short" : "Note (optional)"} value={reason} onChange={(event) => setReason(event.target.value)} />
              ) : null}
              <FormError error={action.error} />
              <div className="flex flex-wrap gap-2">
                {order.status === "DRAFT" && access.can("plan.edit") ? <Button onClick={() => act("submit")}>Submit for approval</Button> : null}
                {order.status === "SUBMITTED" && access.can("plan.approve") ? (
                  <>
                    <Button onClick={() => act("approve", { approveShort: needs.short.length > 0, reason })}>{needs.short.length ? "Approve although short" : "Approve"}</Button>
                    <Button variant="secondary" onClick={() => act("send-back", { reason })}>
                      Send back
                    </Button>
                  </>
                ) : null}
                {["DRAFT", "SUBMITTED", "APPROVED"].includes(order.status) && access.can("plan.edit") ? (
                  <Button variant="destructive" onClick={() => act("cancel", { reason })}>
                    Cancel order
                  </Button>
                ) : null}
                {order.status === "COMPLETED" && access.can("plan.edit") ? (
                  <Button variant="secondary" onClick={() => act("close")}>
                    Close
                  </Button>
                ) : null}
              </div>
            </div>

            <section className="space-y-2">
              <h2 className="text-base font-semibold">Batches</h2>
              {query.data.batches.length ? (
                <ul className="space-y-1 text-sm">
                  {query.data.batches.map((batch) => (
                    <li key={batch.id}>
                      <Link className="font-mono underline" href={`/milling/production/${batch.id}`}>
                        {batch.code}
                      </Link>{" "}
                      · started {formatWhen(batch.startedAt)} · {formatKg(Number(batch.maizeIssuedKg))} maize · <MillStatus status={batch.status} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No batch yet. Start one from Production once the order is approved.</p>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
