"use client";

import "@/components/dashboard-frame/dashboard-frame.css";

import { Suspense } from "react";

import { MaintenanceCalendar } from "@/components/maintenance/maintenance-calendar";

/** Assets › Preventive maintenance: the month calendar; All plans opens the list. */
export default function MaintenanceSchedulePage() {
  return (
    <Suspense>
      <MaintenanceCalendar />
    </Suspense>
  );
}
