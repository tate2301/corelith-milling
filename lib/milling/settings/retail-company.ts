import { companyPage } from "@/lib/retail/settings-pages/company";
import type { SettingsPage } from "@/lib/retail/settings-pages";

/** Same retail record and validation, without the unrelated workspace-profile switch. */
export const millRetailCompanyPage: SettingsPage = {
  ...companyPage,
  title: "Business and shop kind",
  schema: companyPage.schema.omit({ workspaceProfile: true }),
  sections: [
    ...companyPage.sections.filter((section) => !section.fields.some((field) => field.id === "workspaceProfile")),
    {
      title: "Retail contact and tax",
      fields: [
        { id: "whatsapp", t: "text", l: "Shop WhatsApp number", p: "+263…" },
        { id: "vatRegistered", t: "toggle", l: "Registered for VAT" },
      ],
    },
  ],
};
