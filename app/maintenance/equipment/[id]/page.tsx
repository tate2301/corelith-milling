"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";

import { RecordFrame } from "@/components/record-frame/record-frame";
import { equipmentKind } from "@/lib/maintenance/record-kinds";

/** A machine or vehicle: its work, its plans, its fuel and its meter. On core's RecordFrame (lib/maintenance/record-kinds.ts). */
export default function MaintenanceEquipmentRecordPage() {
  return (
    <Suspense>
      <Record />
    </Suspense>
  );
}

function Record() {
  const params = useParams<{ id: string }>();
  return <RecordFrame kind={equipmentKind} id={params?.id ?? ""} />;
}
