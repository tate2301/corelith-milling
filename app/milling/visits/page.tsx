import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/**
 * Customers › Visits (HM-D1), drawn by ListFrame from `milling-visit-list`.
 * A visit is recorded on the phone at /milling/visits/new.
 */
export default function MillVisitsPage() {
  return (
    <Suspense>
      <ListFrame source="milling-visit-list" title="Visits" />
    </Suspense>
  );
}
