import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/**
 * Production › Downtime (canvas DT-A1), drawn by ListFrame from
 * `milling-downtime-list`. Log downtime opens the `mill-stop-new` sheet.
 */
export default function MillDowntimePage() {
  return (
    <Suspense>
      <ListFrame source="milling-downtime-list" title="Downtime" />
    </Suspense>
  );
}
