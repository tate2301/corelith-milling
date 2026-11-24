"use client";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/** Assets › Machinery and vehicles: the register, a tab each, with what each is doing and its next service. Drawn by ListFrame from `assets-equipment` (lib/reports/definitions/maintenance.ts). */
export default function MaintenanceEquipmentPage() {
  return (
    <Suspense>
      <ListFrame source="assets-equipment" title="Machinery and vehicles" />
    </Suspense>
  );
}
