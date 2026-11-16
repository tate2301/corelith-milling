"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

import { FormError } from "./form-bits";

/**
 * Asks why before an action that keeps the reason with the record: cancelling
 * an order, marking someone absent. Mount it only while it is open, so each
 * opening starts empty.
 */
export function ReasonDialog({
  title,
  description,
  confirmLabel,
  destructive,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const ready = reason.trim().length >= 3;
  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form
          id="mill-reason"
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) onConfirm(reason.trim());
          }}
        >
          <Textarea aria-label="Reason" rows={3} autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why" />
          <FormError error={error ?? null} />
        </form>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button type="submit" form="mill-reason" variant={destructive ? "destructive" : "default"} disabled={!ready || pending}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
