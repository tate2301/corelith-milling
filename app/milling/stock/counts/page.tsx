import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/** Stores › Lot counts, drawn by ListFrame from `milling-lot-count-list`; Count a place opens its sheet. */
export default function MillLotCountsPage() {
  return (
    <Suspense>
      <ListFrame source="milling-lot-count-list" title="Lot counts" />
    </Suspense>
  );
}
