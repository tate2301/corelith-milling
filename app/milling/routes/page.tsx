import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/**
 * Despatch › Routes (canvas DS-B2), drawn by ListFrame from
 * `milling-route-list`. New route opens `mill-route-new`; a route opens with its stops.
 */
export default function MillRoutesPage() {
  return (
    <Suspense>
      <ListFrame source="milling-route-list" title="Routes" />
    </Suspense>
  );
}
