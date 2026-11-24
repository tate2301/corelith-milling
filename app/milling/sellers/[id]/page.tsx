"use client";

import { MillRecord } from "@/components/milling/mill-record";
import { sellerKind } from "@/lib/milling/record-kinds/seller";

/** A seller on core's RecordFrame (lib/milling/record-kinds/seller.ts): owed, commission earned, paid and due; trips, commission and payments. */
export default function MillSellerPage() {
  return <MillRecord kind={sellerKind} />;
}
