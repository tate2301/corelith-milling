import "@/components/list-frame/list-frame.css";

import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";

/**
 * Despatch › Sellers, drawn by ListFrame from `milling-seller-list`
 * (extensions/milling/lists/sellers.ts). A seller opens their record; giving
 * bags, payments, commission and the rates open as sheets.
 */
export default function MillSellersPage() {
  return (
    <Suspense>
      <ListFrame source="milling-seller-list" title="Sellers" />
    </Suspense>
  );
}
