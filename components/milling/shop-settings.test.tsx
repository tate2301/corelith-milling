// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { settingsQueryKey } from "@/components/settings-frame/model";
import { EmbeddedSettings } from "@/components/settings-frame/settings-embedding";
import { SettingsFrame } from "@/components/settings-frame/settings-frame";
import { millRetailCompanyPage } from "@/lib/milling/settings/retail-company";
import { RETAIL_SETUP_STEPS } from "@/lib/milling/settings/navigation";
import { MillShopSettings } from "./shop-settings";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/milling/settings/shop" }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u", name: "Owner", role: "SUPERADMIN" } } }) }));
vi.mock("@/components/layout/page-chrome", () => ({ PageChrome: ({ title }: { title: string }) => <div data-app-chrome>{title}</div> }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let client: QueryClient;
afterEach(() => { act(() => root?.unmount()); client?.clear(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });

const SAVED = {
  businessType: "Liquor store", ageCheck: true, licenceHours: true, emptiesAndDeposits: true, casesAndSingles: true,
  licenceNumber: "", licenceExpiresOn: "", currency: "US$", financialYearStarts: "1 January", whatsapp: "", vatRegistered: true,
};
async function mount(canEdit = true, failure = false, embedded = true) {
  let values = { ...SAVED };
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      if (failure) return Response.json({ error: "You cannot change this shop" }, { status: 403 });
      values = { ...values, ...JSON.parse(String(init.body)).changes };
    }
    return Response.json({ values, canEdit, lastChanged: null });
  });
  vi.stubGlobal("fetch", fetcher);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const form = <SettingsFrame page="company" definition={millRetailCompanyPage} actions={<button type="button">Test receipt action</button>} />;
  act(() => root.render(<QueryClientProvider client={client}>{embedded ? <EmbeddedSettings>{form}</EmbeddedSettings> : form}</QueryClientProvider>));
  await settle(); await settle();
  return fetcher;
}
const button = (name: string) => [...document.querySelectorAll("button")].find((element) => element.textContent?.trim().startsWith(name))!;
function selectGeneral() { act(() => button("General retail").click()); }
function save() { act(() => button("Save changes").click()); }

describe("the original retail settings form embedded at the mill", () => {
  it("leaves standalone settings chrome and layout unchanged", async () => {
    await mount(true, false, false);
    expect(document.querySelector(".cx-sf--embedded")).toBeNull();
    expect(document.querySelector("[data-app-chrome]")?.textContent).toBe("Business and shop kind");
  });

  it("saves only businessType through the existing endpoint and invalidates till context", async () => {
    const fetcher = await mount();
    expect(document.querySelector(".cx-sf--embedded")).not.toBeNull();
    expect(document.querySelector("[data-app-chrome]")).toBeNull();
    expect(button("Test receipt action")).toBeDefined();
    expect(button("Activity")).toBeDefined();
    expect(document.body.textContent).not.toContain("Workspace profile");
    expect(document.body.textContent).toContain("Shop WhatsApp number");
    expect(document.body.textContent).toContain("Registered for VAT");
    const invalidate = vi.spyOn(client, "invalidateQueries");
    selectGeneral(); save(); await settle(); await settle();
    const call = fetcher.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(call[0]).toBe("/api/v2/retail/settings/company");
    expect(JSON.parse(String(call[1]?.body))).toEqual({ changes: { businessType: "General retail" } });
    expect(client.getQueryData(settingsQueryKey("company"))).toMatchObject({ values: { businessType: "General retail" }, canEdit: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["till-context"] });
    expect(document.body.textContent).toContain("Saved just now");
  });

  it("preserves discard behavior and does not write discarded changes", async () => {
    const fetcher = await mount();
    selectGeneral(); act(() => button("Discard").click()); await settle();
    expect(document.body.textContent).not.toContain("change not saved");
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("preserves read-only access without owner permission", async () => {
    const fetcher = await mount(false);
    expect(button("Save changes")).toBeUndefined();
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
    expect(document.body.textContent).toContain("Owners only");
  });

  it("keeps failed changes and shows the server error", async () => {
    await mount(true, true);
    selectGeneral(); save(); await settle(); await settle();
    expect(document.body.textContent).toContain("You cannot change this shop");
    expect(document.body.textContent).toContain("1 change not saved");
    expect(client.getQueryData(settingsQueryKey("company"))).toMatchObject({ values: { businessType: "Liquor store" } });
  });
});

describe("retail selling setup", () => {
  it("provides real setup destinations without claiming completion", () => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    act(() => root.render(<MillShopSettings />));
    const guide = document.querySelector('ol[aria-label="Set up retail selling"]')!;
    expect(guide.querySelectorAll("a")).toHaveLength(RETAIL_SETUP_STEPS.length);
    for (const step of RETAIL_SETUP_STEPS) expect(guide.querySelector(`a[href="${step.href}"]`)).not.toBeNull();
    expect(document.body.textContent).toContain("not a confirmation");
    expect(document.querySelector('a[href="/milling/settings/shop/payments"]')).not.toBeNull();
  });
});
