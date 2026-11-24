// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";

import { GENERAL_SETTINGS_FIELDS } from "@/lib/milling/settings/fields";
const access = vi.hoisted(() => ({ edit: true }));
vi.mock("@/components/milling/use-mill-access", () => ({ useMillAccess: () => ({ can: () => access.edit }) }));
vi.mock("@/components/layout/page-chrome", () => ({ PageChrome: () => null }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import GeneralPage from "./page";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let client: QueryClient;
afterEach(() => { act(() => root?.unmount()); client?.clear(); vi.unstubAllGlobals(); access.edit = true; document.body.innerHTML = ""; });
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
const button = (label: string) => [...document.querySelectorAll("button")].find((node) => node.textContent === label)!;
async function mount(edit = true) {
  access.edit = edit;
  const saved = Object.fromEntries(GENERAL_SETTINGS_FIELDS.map((field) => [field.key, 1]));
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => Response.json(init?.method === "PUT" ? JSON.parse(String(init.body)) : saved));
  vi.stubGlobal("fetch", fetcher);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root.render(<QueryClientProvider client={client}><GeneralPage /></QueryClientProvider>));
  await settle(); await settle();
  return fetcher;
}
function change() {
  act(() => {
    const input = document.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "2");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("uses the original save bar with discard, and writes mill settings only on save", async () => {
  const fetcher = await mount();
  change(); expect(document.body.textContent).toContain("1 change not saved");
  act(() => button("Discard").click()); await settle();
  expect(document.querySelector("input")?.value).toBe("1");
  change(); act(() => button("Save changes").click()); await settle(); await settle();
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method === "PUT");
  expect(writes).toHaveLength(1);
  expect(writes[0][0]).toBe("/api/milling/settings/general");
  // The first field drawn is the shift length, under Shift.
  expect(JSON.parse(String(writes[0][1]?.body)).shiftHours).toBe("2");
  expect(document.body.textContent).not.toContain("change not saved");
});
it("keeps mill group read-only restrictions", async () => {
  const fetcher = await mount(false);
  expect([...document.querySelectorAll("input")].every((input) => input.disabled)).toBe(true);
  expect(button("Save changes")).toBeUndefined();
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
});
