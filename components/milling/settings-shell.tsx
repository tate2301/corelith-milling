"use client";

import { NavRail, NavRailItem } from "@corelithzw/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { OwnsChrome } from "@/components/management/ui";
import { ManagementShell } from "@/components/settings/management-shell";
import { MILL_SETTINGS_SECTIONS, millSettingsSection } from "@/lib/milling/settings/navigation";

import styles from "./settings.module.css";

/** The same settings paint scope as Management, with route-backed, responsive section navigation. */
export function MillSettingsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const active = millSettingsSection(pathname);
  return (
    <ManagementShell>
      <OwnsChrome>
        <PageChrome title={active?.label ?? "Mill settings"} />
        <div className={styles.layout}>
          <NavRail label="Mill settings" orientation="responsive">
            {MILL_SETTINGS_SECTIONS.map((section) => (
              <NavRailItem key={section.href} asChild active={active?.href === section.href}>
                <Link href={section.href}>{section.label}</Link>
              </NavRailItem>
            ))}
          </NavRail>
          <div className={styles.content}>{children}</div>
        </div>
      </OwnsChrome>
    </ManagementShell>
  );
}
