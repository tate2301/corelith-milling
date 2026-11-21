import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/**
 * Production › Runs (canvas PR-A1), drawn by ListFrame from `milling-run-list`.
 * New run opens the `mill-run-start` sheet; a run opens at /milling/production/[id].
 */
export default function MillProductionPage() {
  return (
    <Suspense>
      <ListFrame source="milling-run-list" title="Runs" />
    </Suspense>
  );
}
