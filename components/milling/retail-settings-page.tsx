"use client";

import type { ComponentType } from "react";

// Reuse the original pages, including their action buttons and live aside slots.
import PaymentsSettingsPage from "@/app/retail/manage/payments/page";
import ReceiptsSettingsPage from "@/app/retail/manage/receipts/page";
import FiscalSettingsPage from "@/app/retail/manage/fiscal/page";
import PostingSettingsPage from "@/app/retail/manage/posting/page";
import ApprovalSettingsPage from "@/app/retail/manage/approvals/page";
import { EmbeddedSettings } from "@/components/settings-frame/settings-embedding";
import { SettingsFrame } from "@/components/settings-frame/settings-frame";
import { RETAIL_SETTINGS_SECTIONS } from "@/lib/milling/settings/navigation";
import { millRetailCompanyPage } from "@/lib/milling/settings/retail-company";

import { MillRetailSettingsShell } from "./shop-settings";

type RetailSection = (typeof RETAIL_SETTINGS_SECTIONS)[number]["key"];
const PAGES: Record<RetailSection, ComponentType> = {
  company: () => <SettingsFrame page="company" definition={millRetailCompanyPage} />,
  payments: PaymentsSettingsPage,
  receipts: ReceiptsSettingsPage,
  fiscal: FiscalSettingsPage,
  posting: PostingSettingsPage,
  approvals: ApprovalSettingsPage,
};

export function MillRetailSettingsPage({ section }: { section: string }) {
  const selected = RETAIL_SETTINGS_SECTIONS.find((entry) => entry.key === section);
  const Page = selected ? PAGES[selected.key] : null;
  return (
    <MillRetailSettingsShell>
      {Page ? <EmbeddedSettings><Page /></EmbeddedSettings> : <p role="alert">No such retail setting. Choose a section above.</p>}
    </MillRetailSettingsShell>
  );
}
