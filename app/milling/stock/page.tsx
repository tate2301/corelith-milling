import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/** Stores › Lots and bins, drawn by ListFrame from `milling-lot-list` (extensions/milling/lists/stock.ts); a lot moves from its row. */
export default function MillLotsPage() {
  return (
    <Suspense>
      <ListFrame source="milling-lot-list" title="Lots and bins" />
    </Suspense>
  );
}
