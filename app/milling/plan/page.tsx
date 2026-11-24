import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/**
 * Production › Plan, drawn by ListFrame from `milling-plan-list`
 * (extensions/milling/lists/people.ts). Approve and Send back work over the
 * ticked plans (AP-A1); Plan production opens the `mill-plan-new` sheet.
 */
export default function MillPlanPage() {
  return (
    <Suspense>
      <ListFrame source="milling-plan-list" title="Plan" />
    </Suspense>
  );
}
