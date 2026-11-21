import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/**
 * Production › Generator log (canvas DT-B1), drawn by ListFrame from
 * `milling-generator-list`. Log a run opens the `mill-generator-run` sheet.
 */
export default function MillGeneratorPage() {
  return (
    <Suspense>
      <ListFrame source="milling-generator-list" title="Generator log" />
    </Suspense>
  );
}
