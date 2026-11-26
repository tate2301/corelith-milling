import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/**
 * Settings › Cost treatments (Grandmeal spec, Workspace setup), drawn by
 * ListFrame from `milling-cost-treatment-list`: accounting sets where each
 * item's cost lands in profit and loss.
 */
export default function MillCostTreatmentsPage() {
  return (
    <Suspense>
      <ListFrame source="milling-cost-treatment-list" title="Cost treatments" />
    </Suspense>
  );
}
