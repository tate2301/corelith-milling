"use client";

import "@/components/record-frame/record-frame.css";

import { Suspense } from "react";
import { useParams } from "next/navigation";

import { useMillGrants } from "@/components/milling/mill-grants";
import { RecordFrame } from "@/components/record-frame/record-frame";
import type { RecordKind } from "@/lib/retail/record-kinds/types";

/**
 * A mill record on core's RecordFrame, as Retail's records are, with the
 * mill's own grants answered from the person's groups.
 */
export function MillRecord<R>({ kind, id }: { kind: RecordKind<R>; id?: string }) {
  return (
    <Suspense>
      <Record kind={kind} id={id} />
    </Suspense>
  );
}

/** `id`: a record with one of it (the opening stock) has no id in its address. */
function Record<R>({ kind, id }: { kind: RecordKind<R>; id?: string }) {
  const params = useParams<{ id: string }>();
  const can = useMillGrants();
  return <RecordFrame kind={kind} id={id ?? params?.id ?? ""} extensionCan={can} />;
}
