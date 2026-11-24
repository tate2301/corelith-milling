"use client";

import { MillRecord } from "@/components/milling/mill-record";
import { intakeKind } from "@/lib/milling/record-kinds/quality";

/** A weighbridge ticket (canvas IN-C1) on core's RecordFrame (lib/milling/record-kinds/quality.ts). */
export default function MillIntakePage() {
  return <MillRecord kind={intakeKind} />;
}
