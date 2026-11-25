import { redirect } from "next/navigation";

/** The mill sells from the dashboard; the old Till row opens Sell there. */
export default function MillGateTill() {
  redirect("/milling/sales?sheet=mill-sell");
}
