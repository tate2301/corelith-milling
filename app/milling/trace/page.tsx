"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useState } from "react";

import { DashboardFrame, DashSkeleton } from "@/components/dashboard-frame/dashboard-frame";
import { Panel } from "@/components/dashboard-frame/panel";
import { PageChrome } from "@/components/layout/page-chrome";
import { LoadError } from "@/components/list-frame/list-states";
import styles from "@/components/milling/trace-tree.module.css";
import { Button } from "@/components/workspace/button";
import { TextInput } from "@/components/workspace/fields/text-input";
import { fetchJson, getApiErrorMessage } from "@/lib/api-client";
import type { TraceNode } from "@/lib/milling/reports/trace";

type Trace = Array<{ lotId: string; back: TraceNode | null; forward: TraceNode | null }>;

const KIND: Record<TraceNode["kind"], string> = { intake: "Delivery in", lot: "Lot", batch: "Run", pack: "Packing", delivery: "Delivery out", gate: "Gate sale" };

/** Every step of the tree as a row, its depth as its indent. */
function rows(node: TraceNode, depth = 0): Array<{ node: TraceNode; depth: number }> {
  return [{ node, depth }, ...node.children.flatMap((child) => rows(child, depth + 1))];
}

function Tree({ node }: { node: TraceNode }) {
  return (
    <ul className={styles.tree}>
      {rows(node).map(({ node: step, depth }, index) => (
        <li key={`${step.kind}-${step.id}-${index}`}>
          <div className={styles.row} style={{ "--depth": depth } as React.CSSProperties}>
            <span className={styles.kind}>{KIND[step.kind]}</span>
            <span className={styles.what}>
              {step.href ? (
                <Link className={styles.code} href={step.href}>
                  {step.code}
                </Link>
              ) : (
                <span className={styles.code}>{step.code}</span>
              )}
              <span className={styles.label}> · {step.label}</span>
            </span>
            <span className={styles.qty}>{step.quantity ?? ""}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Trace (R8), on core's DashboardFrame: from any lot, delivery in, run,
 * pack run or delivery out, back to the suppliers and forward to every
 * customer. For a recall, start from the lot.
 */
export default function MillTracePage() {
  const params = useSearchParams();
  const router = useRouter();
  const code = params.get("code") ?? "";
  const [typed, setTyped] = useState(code);
  const query = useQuery({ queryKey: ["milling", "trace", code], queryFn: () => fetchJson<Trace>(`/api/milling/trace?code=${encodeURIComponent(code)}`), enabled: Boolean(code), retry: false });
  const toolbar = (
    <div role="toolbar" aria-label="Trace" className="cx-df-toolbar cx-df-toolbar--wrap">
      <form
        className={styles.search}
        onSubmit={(event) => {
          event.preventDefault();
          if (typed.trim()) router.push(`/milling/trace?code=${encodeURIComponent(typed.trim())}`);
        }}
      >
        <TextInput aria-label="Code to trace" mono placeholder="M-261116-01, B-261116-01, DN-261117-02…" value={typed} onChange={(event) => setTyped(event.target.value)} />
        <Button type="submit" variant="primary">
          Trace
        </Button>
      </form>
    </div>
  );
  return (
    <>
      <PageChrome title="Trace" />
      {query.isError ? (
        <LoadError noun="trace" message={getApiErrorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DashboardFrame variant="overview" label="Trace" toolbar={toolbar}>
          {!code ? (
            <Panel span={12} title="Trace a lot, a run or a delivery" empty="See where it came from, down to the supplier, and where it went, out to each customer. For a recall, start from the lot." />
          ) : !query.data ? (
            <>
              <div className="cx-df-span-6">
                <DashSkeleton height={280} />
              </div>
              <div className="cx-df-span-6">
                <DashSkeleton height={280} />
              </div>
            </>
          ) : !query.data.length ? (
            <Panel span={12} title={code} empty="Nothing at the mill has this code." />
          ) : (
            query.data.map((entry) => (
              <Fragment key={entry.lotId}>
                <Panel span={6} title="Where it came from" qualifier="back to the supplier" empty={entry.back ? null : "Nothing before it."}>
                  {entry.back ? <Tree node={entry.back} /> : null}
                </Panel>
                <Panel span={6} title="Where it went" qualifier="out to each customer" empty={entry.forward ? null : "Nothing after it yet."}>
                  {entry.forward ? <Tree node={entry.forward} /> : null}
                </Panel>
              </Fragment>
            ))
          )}
        </DashboardFrame>
      )}
    </>
  );
}
