"use client";

import { MillRecord } from "@/components/milling/mill-record";
import { customerKind } from "@/lib/milling/record-kinds/customer-route";

/** A customer's account (canvas CU-A2) on core's RecordFrame (lib/milling/record-kinds/customer-route.ts). */
export default function MillCustomerPage() {
  return <MillRecord kind={customerKind} />;
}
