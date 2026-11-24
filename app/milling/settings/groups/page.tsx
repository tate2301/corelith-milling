import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/**
 * Settings › Who does what, drawn by ListFrame from `milling-setting-groups`
 * (extensions/milling/lists/groups.ts): a row opens the sheet where that
 * person's mill groups are ticked.
 */
export default function MillGroupsPage() {
  return (
    <Suspense>
      <ListFrame source="milling-setting-groups" title="Who does what" />
    </Suspense>
  );
}
