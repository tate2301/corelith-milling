import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/**
 * Waiting for you (HM-A1), drawn by ListFrame from `milling-waiting`
 * (extensions/milling/lists/waiting.ts): plans and shifts approved or sent
 * back from here, the rest opened to their record.
 */
export default function MillWaitingPage() {
  return (
    <Suspense>
      <ListFrame source="milling-waiting" title="Waiting for you" />
    </Suspense>
  );
}
