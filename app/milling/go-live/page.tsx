import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/** Go-live (GL-A1), drawn by ListFrame from `milling-go-live` (extensions/milling/lists/go-live.ts). */
export default function MillGoLivePage() {
  return (
    <Suspense>
      <ListFrame source="milling-go-live" title="Go-live" />
    </Suspense>
  );
}
