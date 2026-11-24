import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/**
 * Despatch › Orders, drawn by ListFrame from `milling-order-list`. New order
 * opens `mill-order-new`; Confirm, Invoice and Cancel work from a row or the ticked orders.
 */
export default function MillOrdersPage() {
  return (
    <Suspense>
      <ListFrame source="milling-order-list" title="Orders" />
    </Suspense>
  );
}
