"use client";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/** Assets › Fuel log: every issue of fuel to a machine or vehicle, with its meter. Drawn by ListFrame from `assets-fuel-log` (lib/reports/definitions/maintenance.ts). */
export default function MaintenanceFuelLogPage() {
  return (
    <Suspense>
      <ListFrame source="assets-fuel-log" title="Fuel log" />
    </Suspense>
  );
}
