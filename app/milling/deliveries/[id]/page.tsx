"use client";

import { MillRecord } from "@/components/milling/mill-record";
import { tripKind } from "@/lib/milling/record-kinds/trip";

/**
 * A trip (canvas DS-A2) on core's RecordFrame (lib/milling/record-kinds/trip.ts):
 * its stops, what comes next as the primary, and its history in the rail.
 */
export default function MillTripPage() {
  return <MillRecord kind={tripKind} />;
}
