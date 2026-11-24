import { redirect } from "next/navigation";

import { MaintenanceHome } from "@/components/maintenance/maintenance-home";

/** Old `?view=` links land on the page that replaced each view. */
const VIEWS: Record<string, string> = {
  equipment: "/maintenance/equipment",
  "work-orders": "/maintenance/work-orders",
  breakdown: "/maintenance/work-orders?sheet=maint-breakdown",
  schedule: "/maintenance/schedule",
};

/** Assets' homepage (components/maintenance/maintenance-home.tsx). */
export default async function MaintenanceHomePage({ searchParams }: { searchParams?: Promise<{ view?: string }> }) {
  const view = (await searchParams)?.view;
  if (view && VIEWS[view]) redirect(VIEWS[view]);
  return <MaintenanceHome />;
}
