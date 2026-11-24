import { redirect } from "next/navigation";

/** Counting a place is a sheet over the counts now. */
export default function MillStockCountPage() {
  redirect("/milling/stock/counts?sheet=mill-count-place");
}
