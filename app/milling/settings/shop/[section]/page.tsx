"use client";

import { useParams } from "next/navigation";

import { MillSettingsShell } from "@/components/milling/settings-shell";
import { MillRetailSettingsPage } from "@/components/milling/retail-settings-page";

export default function MillRetailConfigurationPage() {
  const { section } = useParams<{ section: string }>();
  return <MillSettingsShell><MillRetailSettingsPage key={section} section={section} /></MillSettingsShell>;
}
