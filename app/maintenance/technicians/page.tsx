"use client";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/** Assets › Technicians: who does the work, their trade and what is on their plate. Drawn by ListFrame from `assets-technicians` (lib/reports/definitions/maintenance.ts). */
export default function MaintenanceTechniciansPage() {
  return (
    <Suspense>
      <ListFrame source="assets-technicians" title="Technicians" />
    </Suspense>
  );
}
