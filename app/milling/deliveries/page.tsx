import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/**
 * Despatch › Despatches (canvas DS-A1), drawn by ListFrame from
 * `milling-despatch-list`. New despatch note opens `mill-despatch-new`; a note opens at /milling/deliveries/[id].
 */
export default function MillDeliveriesPage() {
  return (
    <Suspense>
      <ListFrame source="milling-despatch-list" title="Despatches" />
    </Suspense>
  );
}
