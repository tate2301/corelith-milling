"use client";

import { MillRecord } from "@/components/milling/mill-record";
import { shiftKind } from "@/lib/milling/record-kinds/plan-shift";

/** A shift on core's RecordFrame (lib/milling/record-kinds/plan-shift.ts): the crew, runs and handover. */
export default function MillShiftPage() {
  return <MillRecord kind={shiftKind} />;
}
