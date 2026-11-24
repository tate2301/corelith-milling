"use client";

import { MillRecord } from "@/components/milling/mill-record";
import { planKind } from "@/lib/milling/record-kinds/plan-shift";

/** A production plan on core's RecordFrame (lib/milling/record-kinds/plan-shift.ts). */
export default function MillPlanPage() {
  return <MillRecord kind={planKind} />;
}
