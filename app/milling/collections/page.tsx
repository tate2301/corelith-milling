import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/**
 * Customers › Collections (canvas CU-A1), drawn by ListFrame from
 * `milling-customer-list`. A row opens each customer to their account; Record a
 * promise and Limit and terms open sheets.
 */
export default function MillCollectionsPage() {
  return (
    <Suspense>
      <ListFrame source="milling-customer-list" title="Collections" />
    </Suspense>
  );
}
