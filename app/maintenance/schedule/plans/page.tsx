"use client";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/** Assets › Plans: every preventive plan, what is due, booked or ahead. Drawn by ListFrame from `assets-plans` (lib/reports/definitions/maintenance.ts). */
export default function MaintenancePlansPage() {
  return (
    <Suspense>
      <ListFrame source="assets-plans" title="Preventive plans" />
    </Suspense>
  );
}
