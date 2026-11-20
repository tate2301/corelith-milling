"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { FormError } from "@/components/milling/form-bits";
import { ReasonDialog } from "@/components/milling/reason-dialog";
import { useMillPost } from "@/components/milling/use-mill-post";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type BulkAction = "approve" | "send-back";
export type WaitingRow = {
  key: string;
  code: string;
  what: string;
  href: string;
  sentBy: string | null;
  sentAt: string;
  quantity: string | null;
  bulk?: { kind: "plan" | "shift"; actions: BulkAction[] };
};
type Result = { kind: string; id: string; ok: boolean; message: string };

const sent = (value: string) => new Date(value).toLocaleString("en-ZW", { weekday: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Waiting for you (HM-A1). Records decided in one press (plans, shifts) can be
 * chosen together and approved, or sent back with a reason; the rest open
 * their record. Each chosen record is decided through its own checks, and
 * each one's answer is shown.
 */
export function WaitingForYou({ rows }: { rows: WaitingRow[] }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [sendingBack, setSendingBack] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const decide = useMillPost<{ results: Result[] }>({ onDone: (answer) => (setResults(answer.results), setChosen([]), setSendingBack(false)) });

  const selectable = rows.filter((row) => row.bulk);
  const picked = rows.filter((row) => chosen.includes(row.key));
  const canSendBack = picked.length > 0 && picked.every((row) => row.bulk?.actions.includes("send-back"));
  const kinds = [...new Set(picked.map((row) => row.what.toLowerCase()))].join(" and ");
  const submit = (action: BulkAction, reason?: string) =>
    decide.post("/api/milling/decide-many", { action, reason: reason ?? null, items: picked.map((row) => ({ kind: row.bulk!.kind, id: row.key })) });

  // A to approve, Esc to clear, as the board draws them; not while typing.
  useEffect(() => {
    if (!picked.length) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target instanceof HTMLInputElement ? !["checkbox", "radio", "button"].includes(target.type) : target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (typing) return;
      if (sendingBack || decide.pending) return;
      if (event.key === "Escape") setChosen([]);
      if (event.key.toLowerCase() === "a" && !event.metaKey && !event.ctrlKey) submit("approve");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toggle = (key: string, on: boolean) => setChosen((current) => (on ? [...new Set([...current, key])] : current.filter((entry) => entry !== key)));
  const allOn = selectable.length > 0 && selectable.every((row) => chosen.includes(row.key));

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold">Waiting for you</h2>
        <span className="text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? "record" : "records"}
        </span>
      </div>
      {results ? (
        <ul className="space-y-1 rounded-md border border-border p-3 text-sm" aria-live="polite">
          {results.map((row) => (
            <li key={row.id} className={row.ok ? "" : "text-destructive"}>
              {row.message}
            </li>
          ))}
          <li>
            <Button size="sm" variant="ghost" onClick={() => setResults(null)}>
              Done
            </Button>
          </li>
        </ul>
      ) : null}
      <FormError error={decide.error} />
      {!rows.length ? (
        <p className="text-sm text-muted-foreground">Nothing is waiting for your decision.</p>
      ) : (
        <>
          <ul className="divide-y divide-border rounded-md border border-border md:hidden">
            {rows.map((row) => (
              <li key={row.key} className="flex gap-3 p-3">
                {row.bulk ? <Checkbox aria-label={`Choose ${row.code}`} checked={chosen.includes(row.key)} onCheckedChange={(on) => toggle(row.key, on === true)} /> : <span className="w-4" />}
                <div className="flex-1 space-y-1">
                  <div className="flex justify-between gap-2">
                    <Link className="font-mono underline" href={row.href}>
                      {row.code}
                    </Link>
                    <span className="font-mono text-sm">{row.quantity ?? ""}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {row.what}
                    {row.sentBy ? ` · ${row.sentBy}` : ""} · {sent(row.sentAt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table hideControlsWhenSinglePage>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    {selectable.length ? <Checkbox aria-label="Choose all that can be decided here" checked={allOn} onCheckedChange={(on) => setChosen(on === true ? selectable.map((row) => row.key) : [])} /> : null}
                  </TableHead>
                  <TableHead>Record</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Sent by</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key} data-state={chosen.includes(row.key) ? "selected" : undefined}>
                    <TableCell>{row.bulk ? <Checkbox aria-label={`Choose ${row.code}`} checked={chosen.includes(row.key)} onCheckedChange={(on) => toggle(row.key, on === true)} /> : null}</TableCell>
                    <TableCell className="font-mono">
                      <Link className="underline" href={row.href}>
                        {row.code}
                      </Link>
                    </TableCell>
                    <TableCell>{row.what}</TableCell>
                    <TableCell>{row.sentBy ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{sent(row.sentAt)}</TableCell>
                    <TableCell className="text-right font-mono">{row.quantity ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {picked.length ? (
            <div className="sticky bottom-2 flex flex-wrap items-center gap-3 rounded-md border border-border bg-background p-3 shadow-sm">
              <span className="text-sm">
                <span className="font-medium">{picked.length}</span> selected · {kinds}
              </span>
              <Button size="sm" disabled={decide.pending} onClick={() => submit("approve")}>
                Approve <kbd className="ml-1 rounded border px-1 text-xs">A</kbd>
              </Button>
              <Button size="sm" variant="secondary" disabled={decide.pending || !canSendBack} title={canSendBack ? undefined : "Only plans are sent back from here"} onClick={() => setSendingBack(true)}>
                Send back
              </Button>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setChosen([])}>
                Clear <kbd className="ml-1 rounded border px-1 text-xs">Esc</kbd>
              </Button>
            </div>
          ) : null}
          {sendingBack ? (
            <ReasonDialog
              title={`Send back ${picked.length === 1 ? picked[0]!.code : `${picked.length} plans`}?`}
              description="Each goes back to draft for whoever wrote it, with your reason."
              confirmLabel="Send back"
              pending={decide.pending}
              error={decide.error}
              onClose={() => setSendingBack(false)}
              onConfirm={(reason) => submit("send-back", reason)}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
