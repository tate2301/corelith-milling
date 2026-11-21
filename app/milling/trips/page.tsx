import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/**
 * Despatch › Trips (canvas DS-B1), drawn by ListFrame from the
 * `milling-trip-list` source (extensions/milling/lists/trips.ts): tabs by
 * state, Date, Route and Vehicle, and the kilometres and fuel totals.
 */
export default function MillTripsPage() {
  return (
    <Suspense>
      <ListFrame source="milling-trip-list" title="Trips" />
    </Suspense>
  );
}
