import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/**
 * Maintenance › Machine release, drawn by ListFrame from `milling-machine-list`
 * (extensions/milling/lists/maintenance.ts): in repair, repaired and release
 * from a row. Stops and generator runs have their own lists.
 */
export default function MillMachinesPage() {
  return (
    <Suspense>
      <ListFrame source="milling-machine-list" title="Machine release" />
    </Suspense>
  );
}
