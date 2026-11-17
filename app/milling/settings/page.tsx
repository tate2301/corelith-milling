import { redirect } from "next/navigation";

import { MILL_SETTINGS_TABS } from "@/components/milling/settings-shell";

export default function MillSettingsPage() {
  redirect(MILL_SETTINGS_TABS[0].href);
}
