"use client";

import { EmptyState } from "@corelithzw/react";
import { useParams } from "next/navigation";

import { SettingsResourceView } from "@/components/milling/settings-resource";
import { MillSettingsShell } from "@/components/milling/settings-shell";
import { getSettingsResource } from "@/lib/milling/settings/fields";

/** Any of the mill's settings lists, by its key (`lib/milling/settings/fields.ts`). */
export default function MillSettingsListPage() {
  const params = useParams<{ tab: string }>();
  const resource = getSettingsResource(params.tab);
  return (
    <MillSettingsShell>
      {resource ? (
        <SettingsResourceView key={resource.key} resource={resource} />
      ) : (
        <EmptyState title="No such setting" body="Pick one of the tabs above." />
      )}
    </MillSettingsShell>
  );
}
