import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/** Stores › Lot movements, drawn by ListFrame from `milling-lot-movement-list`; `?lot=` scopes it to one lot. */
export default function MillLotMovementsPage() {
  return (
    <Suspense>
      <ListFrame source="milling-lot-movement-list" title="Lot movements" />
    </Suspense>
  );
}
