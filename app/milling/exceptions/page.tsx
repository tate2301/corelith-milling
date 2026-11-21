import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/**
 * Exceptions (F4), drawn by ListFrame from `milling-exception-list`
 * (extensions/milling/lists/exceptions.ts). Decide opens the
 * `mill-exception-decide` sheet (lib/milling/sheets/exceptions.ts).
 */
export default function MillExceptionsPage() {
  return (
    <Suspense>
      <ListFrame source="milling-exception-list" title="Exceptions" />
    </Suspense>
  );
}
