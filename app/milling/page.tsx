"use client";

import { EmptyState } from "@corelithzw/react";

import { PageChrome } from "@/components/layout/page-chrome";

/**
 * The mill's home. Nothing is recorded yet: each workflow (intake,
 * production, quality, packing, despatch) adds what it shows here as it lands.
 */
export default function MillingHomePage() {
  return (
    <>
      <PageChrome title="The mill" />
      <div className="px-4 py-16">
        <EmptyState
          title="Nothing recorded at the mill yet"
          body="Intake, production, packing and despatch appear here as each one goes live."
        />
      </div>
    </>
  );
}
