"use client";

import { MillRecord } from "@/components/milling/mill-record";
import { runKind } from "@/lib/milling/record-kinds/run";

/** A run (canvas PR-A2) on core's RecordFrame (lib/milling/record-kinds/run.ts): the route in the strip, stages, maize, output and balance. */
export default function MillRunPage() {
  return <MillRecord kind={runKind} />;
}
