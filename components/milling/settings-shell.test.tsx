// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/milling/settings/shop/payments" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("@/components/settings/management-shell", () => ({ ManagementShell: ({ children }: { children: ReactNode }) => <div data-management-surface>{children}</div> }));
vi.mock("@/components/layout/page-chrome", () => ({ PageChrome: ({ title }: { title: string }) => <div data-title>{title}</div> }));
import { MillSettingsShell } from "./settings-shell";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = ""; });

it("uses the Management surface and responsive design-system navigation, keeping deep links active", () => {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root.render(<MillSettingsShell><p>Configuration</p></MillSettingsShell>));
  expect(document.querySelector("[data-management-surface]")).not.toBeNull();
  expect(document.querySelector('nav[aria-label="Mill settings"]')).not.toBeNull();
  expect(document.querySelector('a[href="/milling/settings/shop"]')?.getAttribute("aria-current")).toBe("page");
  expect(document.querySelector('[data-title]')?.textContent).toBe("Retail shop");
  expect(document.body.textContent).toContain("Configuration");
});
