import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/** Sales at the mill's own till, drawn by ListFrame from `milling-sale-list` (extensions/milling/lists/sales.ts); Sell opens the till. */
export default function MillSalesPage() {
  return (
    <Suspense>
      <ListFrame source="milling-sale-list" title="Bag sales" />
    </Suspense>
  );
}
