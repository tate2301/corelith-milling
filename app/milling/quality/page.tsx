import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/**
 * Quality › Tests (canvas QT-A1), drawn by ListFrame from `milling-test-list`
 * (extensions/milling/lists/production.ts). A lot opens its tests at
 * /milling/quality/[id]; maize at intake is tested on its ticket.
 */
export default function MillQualityPage() {
  return (
    <Suspense>
      <ListFrame source="milling-test-list" title="Tests" />
    </Suspense>
  );
}
