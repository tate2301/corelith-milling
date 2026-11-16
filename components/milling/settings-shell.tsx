"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { SectionTab, SectionTabs } from "@/components/ui/section-tabs";
import { SETTINGS_RESOURCES } from "@/lib/milling/settings/fields";

/** The mill's settings, one subject per tab. Each tab is its own page under /milling/settings. */
export const MILL_SETTINGS_TABS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/milling/settings/general", label: "Shift and tolerances" },
  ...SETTINGS_RESOURCES.map((resource) => ({ href: `/milling/settings/${resource.key}`, label: resource.label })),
  { href: "/milling/settings/groups", label: "Groups" },
];

export function MillSettingsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <PageChrome title="Mill settings" />
      <div className="px-4 pt-2">
        <SectionTabs label="Mill settings">
          {MILL_SETTINGS_TABS.map((tab) => (
            <SectionTab key={tab.href} to={tab.href} active={pathname?.startsWith(tab.href)}>
              {tab.label}
            </SectionTab>
          ))}
        </SectionTabs>
      </div>
      <div className="px-4 py-4">{children}</div>
    </>
  );
}
