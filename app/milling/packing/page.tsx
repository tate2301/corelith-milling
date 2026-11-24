import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/**
 * Production › Packing (canvas PK-A1), drawn by ListFrame from
 * `milling-packing-list`. New packing run opens the `mill-pack` sheet.
 */
export default function MillPackingPage() {
  return (
    <Suspense>
      <ListFrame source="milling-packing-list" title="Packing" />
    </Suspense>
  );
}
