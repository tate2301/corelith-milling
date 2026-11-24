"use client";

import { MillRecord } from "@/components/milling/mill-record";
import { openingKind } from "@/lib/milling/record-kinds/opening";

/** Opening stock (GL-B1, GL-B2) on core's RecordFrame (lib/milling/record-kinds/opening.ts). */
export default function MillOpeningStockPage() {
  return <MillRecord kind={openingKind} id="current" />;
}
