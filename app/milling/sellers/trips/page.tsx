import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/** Despatch › Seller trips, drawn by ListFrame from `milling-seller-trip-list`: today's by default; settle, call off and post from a row. */
export default function MillSellerTripsPage() {
  return (
    <Suspense>
      <ListFrame source="milling-seller-trip-list" title="Seller trips" />
    </Suspense>
  );
}
