"use client";

import "@/components/list-frame/list-frame.css";

import { EmptyState } from "@corelithzw/react";
import { useParams } from "next/navigation";
import { Suspense } from "react";

import { ListFrame } from "@/components/list-frame/list-frame";
import { getSettingsResource } from "@/lib/milling/settings/fields";

/**
 * Any of the mill's settings lists, by its key, drawn by ListFrame from
 * `milling-setting-<key>` (extensions/milling/lists/settings.ts) as Retail's
 * setup lists are. A row, or Add, opens its sheet.
 */
export default function MillSettingsListPage() {
  const params = useParams<{ tab: string }>();
  const resource = getSettingsResource(params.tab);
  if (!resource) return <EmptyState title="No such setting" body="Pick one from Settings in the sidebar." />;
  return (
    <Suspense>
      <ListFrame source={`milling-setting-${resource.key}`} title={resource.label} />
    </Suspense>
  );
}
