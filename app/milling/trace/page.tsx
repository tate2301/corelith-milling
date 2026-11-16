"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { FormError } from "@/components/milling/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson, getApiErrorMessage } from "@/lib/api-client";
import type { TraceNode } from "@/lib/milling/reports/trace";

type Trace = Array<{ lotId: string; back: TraceNode | null; forward: TraceNode | null }>;

const KIND: Record<TraceNode["kind"], string> = { intake: "Delivery in", lot: "Lot", batch: "Batch", pack: "Packing", delivery: "Delivery out", gate: "Gate" };

function Tree({ node }: { node: TraceNode }) {
  return (
    <li className="space-y-1">
      <div className="text-sm">
        <span className="text-xs text-muted-foreground">{KIND[node.kind]}</span>{" "}
        {node.href ? (
          <Link className="font-mono underline" href={node.href}>
            {node.code}
          </Link>
        ) : (
          <span className="font-mono">{node.code}</span>
        )}{" "}
        · {node.label}
        {node.quantity ? <span className="font-mono"> · {node.quantity}</span> : null}
      </div>
      {node.children.length ? (
        <ul className="ml-4 space-y-1 border-l pl-3">
          {node.children.map((child) => (
            <Tree key={`${child.kind}-${child.id}`} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** From any lot, delivery in, batch, pack run or delivery out: back to the suppliers and forward to the customers. */
export default function MillTracePage() {
  const params = useSearchParams();
  const router = useRouter();
  const code = params.get("code") ?? "";
  const [typed, setTyped] = useState(code);
  const query = useQuery({ queryKey: ["milling", "trace", code], queryFn: () => fetchJson<Trace>(`/api/milling/trace?code=${encodeURIComponent(code)}`), enabled: Boolean(code), retry: false });
  return (
    <>
      <PageChrome title="Trace" />
      <div className="space-y-6 px-4 py-4">
        <form
          className="flex max-w-xl gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            router.push(`/milling/trace?code=${encodeURIComponent(typed.trim())}`);
          }}
        >
          <Input aria-label="Code" placeholder="M-261116-01, B-261116-01, DN-261117-02…" value={typed} onChange={(event) => setTyped(event.target.value)} className="font-mono" />
          <Button type="submit">Trace</Button>
        </form>
        {!code ? (
          <EmptyState title="Trace a lot, a batch or a delivery" body="See where it came from, down to the supplier, and where it went, out to each customer. For a recall, start from the lot." />
        ) : query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : query.isError ? (
          <FormError error={getApiErrorMessage(query.error)} />
        ) : (
          query.data?.map((entry) => (
            <div key={entry.lotId} className="grid gap-6 lg:grid-cols-2">
              <section className="space-y-2">
                <h2 className="text-base font-semibold">Where it came from</h2>
                <ul>{entry.back ? <Tree node={entry.back} /> : null}</ul>
              </section>
              <section className="space-y-2">
                <h2 className="text-base font-semibold">Where it went</h2>
                <ul>{entry.forward ? <Tree node={entry.forward} /> : null}</ul>
              </section>
            </div>
          ))
        )}
      </div>
    </>
  );
}
