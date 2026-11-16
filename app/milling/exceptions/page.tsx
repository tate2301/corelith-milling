"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { formatWhen, MillStatus } from "@/components/milling/mill-ui";
import { targetHref } from "@/components/milling/targets";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SectionTab, SectionTabs } from "@/components/ui/section-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, getApiErrorMessage } from "@/lib/api-client";

type Exception = {
  id: string;
  code: string;
  type: string;
  typeLabel: string;
  severity: string;
  title: string;
  detail: string | null;
  targetType: string;
  targetId: string;
  allowedDecisions: string[];
  status: string;
  decision: string | null;
  decisionNote: string | null;
  raisedBy: string | null;
  decidedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
};

const DECISION_LABEL: Record<string, string> = {
  RELEASE_ANYWAY: "Release anyway",
  KEEP_ON_HOLD: "Keep on hold",
  REJECT: "Reject",
  POST_COUNT: "Post the count",
  DISCARD_COUNT: "Discard the count",
  ACCEPT_VARIANCE: "Accept the variance",
  RECOUNT: "Send back to recount",
  CONTINUE: "Continue",
  STOP: "Stop",
  REDUCE_LOAD: "Reduce the load",
  ACCEPT_SHORTAGE: "Accept the shortage",
  CLAIM: "Claim it back",
  WRITE_OFF: "Write it off",
};

/** Everything waiting for an authorised decision, oldest first; and what was decided. */
export default function MillExceptionsPage() {
  const params = useSearchParams();
  const status = params.get("status") === "DECIDED" ? "DECIDED" : "OPEN";
  const query = useQuery({
    queryKey: ["milling", "exceptions", status],
    queryFn: () => fetchJson<{ open: number; rows: Exception[] }>(`/api/milling/exceptions?status=${status}`),
  });

  return (
    <>
      <PageChrome title="Exceptions" />
      <div className="space-y-4 px-4 py-2">
        <SectionTabs label="Exceptions by status">
          <SectionTab to="/milling/exceptions" active={status === "OPEN"} count={query.data?.open}>
            Open
          </SectionTab>
          <SectionTab to="/milling/exceptions?status=DECIDED" active={status === "DECIDED"}>
            Decided
          </SectionTab>
        </SectionTabs>
        {query.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{getApiErrorMessage(query.error)}</AlertDescription>
          </Alert>
        ) : query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : !query.data?.rows.length ? (
          <EmptyState title={status === "OPEN" ? "Nothing is waiting for a decision" : "No decisions yet"} body="Failed checks, count differences, breakdowns and delivery shortages appear here." />
        ) : (
          <ul className="divide-y">
            {query.data.rows.map((exception) => (
              <ExceptionRow key={exception.id} exception={exception} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function ExceptionRow({ exception }: { exception: Exception }) {
  const access = useMillAccess();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: (decision: string) => fetchJson(`/api/milling/exceptions/${exception.id}/decide`, { method: "POST", body: JSON.stringify({ decision, note }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["milling"] }),
    onError: (failure) => setError(getApiErrorMessage(failure)),
  });
  const href = targetHref(exception.targetType, exception.targetId);
  return (
    <li className="space-y-2 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-sm">{exception.code}</span>
        <span className="font-medium">{exception.title}</span>
        <MillStatus status={exception.status === "OPEN" ? "OPEN_EXCEPTION" : exception.status} />
      </div>
      <div className="text-sm text-muted-foreground">
        {exception.typeLabel} · {exception.severity.toLowerCase()} · raised {formatWhen(exception.createdAt)}
        {exception.raisedBy ? ` by ${exception.raisedBy}` : ""}
        {href ? (
          <>
            {" · "}
            <Link className="underline" href={href}>
              Open the record
            </Link>
          </>
        ) : null}
      </div>
      {exception.detail ? <p className="text-sm">{exception.detail}</p> : null}
      {exception.status === "DECIDED" ? (
        <p className="text-sm">
          {DECISION_LABEL[exception.decision ?? ""] ?? exception.decision} by {exception.decidedBy ?? "someone"} on {formatWhen(exception.decidedAt)}: “{exception.decisionNote}”
        </p>
      ) : access.can("exception.decide") ? (
        <div className="max-w-xl space-y-2">
          <Textarea aria-label={`Reason for ${exception.code}`} rows={2} placeholder="Why: kept with the record" value={note} onChange={(event) => setNote(event.target.value)} />
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {exception.allowedDecisions.map((decision) => (
              <Button key={decision} variant={decision === "REJECT" || decision === "STOP" ? "destructive" : "secondary"} disabled={decide.isPending} onClick={() => (setError(null), decide.mutate(decision))}>
                {DECISION_LABEL[decision] ?? decision}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Management decides this one.</p>
      )}
    </li>
  );
}
