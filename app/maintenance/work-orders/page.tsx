"use client";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/** Assets › Work orders: breakdowns and services, open first. Drawn by ListFrame from `assets-work-orders` (lib/reports/definitions/maintenance.ts). */
export default function MaintenanceWorkOrdersPage() {
  return (
    <Suspense>
      <ListFrame source="assets-work-orders" title="Work orders" />
    </Suspense>
  );
}
