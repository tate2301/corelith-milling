"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { SectionHeading } from "@/components/management/ui";
import { RETAIL_SETTINGS_SECTIONS, RETAIL_SETUP_STEPS } from "@/lib/milling/settings/navigation";

import styles from "./settings.module.css";

/** A route-backed retail setup section, not a second shop configuration store. */
export function MillRetailSettingsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const selected = RETAIL_SETTINGS_SECTIONS.find((section) => pathname === `/milling/settings/shop/${section.key}`);
  return (
    <>
      <nav className={styles.shopNav} aria-label="Retail shop setup">
        <Link href="/milling/settings/shop" aria-current={!selected ? "page" : undefined}>Start selling</Link>
        {RETAIL_SETTINGS_SECTIONS.map((section) => (
          <Link key={section.key} href={`/milling/settings/shop/${section.key}`} aria-current={selected?.key === section.key ? "page" : undefined}>{section.label}</Link>
        ))}
      </nav>
      <SectionHeading variant="form">{selected?.label ?? "Start selling"}</SectionHeading>
      {children}
    </>
  );
}

/** Every step opens a real configuration or operational screen, keeping its original permissions. */
export function MillShopSettings() {
  return (
    <MillRetailSettingsShell>
      <p className="text-sm text-muted-foreground">Work through the setup below before taking sales. These links are a setup guide, not a confirmation that configuration is complete. Access to each step depends on your role and enabled modules.</p>
      <ol className={styles.steps} aria-label="Set up retail selling">
        {RETAIL_SETUP_STEPS.map((step, index) => (
          <li key={step.href}>
            <Link href={step.href}>
              <strong><span className="font-mono inline">{index + 1}.</span> {step.label}</strong>
              <span>{step.detail}</span>
            </Link>
          </li>
        ))}
      </ol>
    </MillRetailSettingsShell>
  );
}
