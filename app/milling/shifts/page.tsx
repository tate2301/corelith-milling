import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/**
 * Production › Shifts, drawn by ListFrame from `milling-shift-list`.
 * Approve works over the ticked closed shifts; Plan a shift opens `mill-shift-new`.
 */
export default function MillShiftsPage() {
  return (
    <Suspense>
      <ListFrame source="milling-shift-list" title="Shifts" />
    </Suspense>
  );
}
