import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/**
 * Surveys (R9), drawn by ListFrame from `milling-survey-list`
 * (extensions/milling/lists/customers.ts): the reps' visits grouped by route,
 * each route totalled.
 */
export default function MillSurveysPage() {
  return (
    <Suspense>
      <ListFrame source="milling-survey-list" title="Surveys" />
    </Suspense>
  );
}
