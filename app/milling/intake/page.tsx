import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/**
 * Intake (canvas IN-A1), drawn by ListFrame from the `milling-intake-list`
 * source (extensions/milling/lists/intake.ts): the day's tickets by state,
 * with the payable kilograms and their value.
 */
export default function MillIntakePage() {
  return (
    <Suspense>
      <ListFrame source="milling-intake-list" title="Intake" />
    </Suspense>
  );
}
