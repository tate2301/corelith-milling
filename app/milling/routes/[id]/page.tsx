"use client";

import { MillRecord } from "@/components/milling/mill-record";
import { routeKind } from "@/lib/milling/record-kinds/customer-route";

/** A route and its stops (canvas DS-B3) on core's RecordFrame (lib/milling/record-kinds/customer-route.ts). */
export default function MillRoutePage() {
  return <MillRecord kind={routeKind} />;
}
