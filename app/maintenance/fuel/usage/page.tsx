"use client";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/** Assets › Fuel usage: each machine's fuel by month against the km it went or the hours it ran. Drawn by ListFrame from `assets-fuel-usage` (lib/reports/definitions/maintenance.ts). */
export default function MaintenanceFuelUsagePage() {
  return (
    <Suspense>
      <ListFrame source="assets-fuel-usage" title="Fuel usage" />
    </Suspense>
  );
}
