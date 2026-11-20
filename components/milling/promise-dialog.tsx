"use client";

import { useState } from "react";

import { Field, FormError } from "@/components/milling/form-bits";
import { useMillPost } from "@/components/milling/use-mill-post";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** Record a customer's promise to pay: how much, and by when. */
export function PromiseDialog({ customerId, name, owes, onClose }: { customerId: string; name: string; owes: number; onClose: () => void }) {
  const [amount, setAmount] = useState(owes.toFixed(2));
  const [promisedFor, setDay] = useState(() => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const save = useMillPost({ done: "Promise recorded", onDone: onClose });
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Promise from {name}</DialogTitle>
          <DialogDescription className="not-sr-only t-body-sm text-[var(--text-muted)]">They owe ${owes.toFixed(2)}. The promise is kept with their account and shows on Collections.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field id="pr-amount" label="Amount">
              <Input id="pr-amount" inputMode="decimal" className="font-mono" value={amount} onChange={(event) => setAmount(event.target.value)} />
            </Field>
            <Field id="pr-day" label="Pays by">
              <Input id="pr-day" type="date" value={promisedFor} onChange={(event) => setDay(event.target.value)} />
            </Field>
          </div>
          <Field id="pr-note" label="Note">
            <Input id="pr-note" value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          <FormError error={save.error} />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.pending} onClick={() => save.post(`/api/milling/customers/${customerId}/promise`, { amount: Number(amount), promisedFor, note: note || null })}>
            Record the promise
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
