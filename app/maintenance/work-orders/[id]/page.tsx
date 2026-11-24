"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";

import { RecordFrame } from "@/components/record-frame/record-frame";
import { workOrderKind } from "@/lib/maintenance/record-kinds";

/** A work order, from Vane's draft, a breakdown or a plan, to done. On core's RecordFrame (lib/maintenance/record-kinds.ts). */
export default function MaintenanceWorkOrderPage() {
  return (
    <Suspense>
      <Record />
    </Suspense>
  );
}

function Record() {
  const params = useParams<{ id: string }>();
  return <RecordFrame kind={workOrderKind} id={params?.id ?? ""} />;
}
