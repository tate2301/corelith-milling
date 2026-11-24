import { redirect } from "next/navigation";

/** Logging a breakdown is a sheet over the work orders. */
export default function MaintenanceBreakdownPage() {
  redirect("/maintenance/work-orders?sheet=maint-breakdown");
}
