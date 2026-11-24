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
export function MillRecord<R>({ kind }: { kind: RecordKind<R> }) {
  return (
    <Suspense>
      <Record kind={kind} />
    </Suspense>
  );
}

function Record<R>({ kind }: { kind: RecordKind<R> }) {
  const params = useParams<{ id: string }>();
  const can = useMillGrants();
  return <RecordFrame kind={kind} id={params?.id ?? ""} extensionCan={can} />;
}
