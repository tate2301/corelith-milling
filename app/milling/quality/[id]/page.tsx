"use client";

import { MillRecord } from "@/components/milling/mill-record";
import { lotKind } from "@/lib/milling/record-kinds/quality";

/** A lot's tests (canvas QT-A2) on core's RecordFrame (lib/milling/record-kinds/quality.ts). */
export default function MillLotPage() {
  return <MillRecord kind={lotKind} />;
}
