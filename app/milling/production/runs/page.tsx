import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/** Production › Production runs (Grandmeal Stage 1), drawn by ListFrame from `milling-production-run-list`. */
export default function MillProductionRunsPage() {
  return (
    <Suspense>
      <ListFrame source="milling-production-run-list" title="Production runs" />
    </Suspense>
  );
}
