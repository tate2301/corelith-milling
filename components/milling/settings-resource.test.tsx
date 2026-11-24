// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, expect, it, vi } from "vitest";

import { getSettingsResource, type SettingsResourceKey } from "@/lib/milling/settings/fields";
import { SettingsResourceView } from "./settings-resource";
const access = vi.hoisted(() => ({ edit: true }));
vi.mock("./use-mill-access", () => ({ useMillAccess: () => ({ can: () => access.edit }) }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let client: QueryClient;
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => { act(() => root?.unmount()); client?.clear(); vi.unstubAllGlobals(); document.body.innerHTML = ""; access.edit = true; });
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
async function mount(key: SettingsResourceKey) {
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => Response.json(init?.method === "POST" ? { id: "created" } : {
    rows: [], options: { siteId: [{ value: "site", label: "Mill site" }], packedProductId: [{ value: "packed", label: "Meal 20 kg" }], bulkProductId: [{ value: "bulk", label: "Meal bulk" }], bagProductId: [{ value: "bag", label: "Empty bag" }] },
  }));
  vi.stubGlobal("fetch", fetcher);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root.render(<QueryClientProvider client={client}><SettingsResourceView resource={getSettingsResource(key)!} /></QueryClientProvider>));
  await settle(); await settle();
  return fetcher;
}
function click(text: string) { act(() => [...document.querySelectorAll("button")].find((node) => node.textContent === text)!.click()); }
function type(key: string, value: string) {
  act(() => {
    const field = document.getElementById(`field-${key}`)!;
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function choose(key: string, value: string) {
  act(() => document.getElementById(`field-${key}`)!.click()); await settle();
  act(() => [...document.querySelectorAll('[role="option"]')].find((option) => option.textContent === value)!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await settle();
}
function submit(key: string) { act(() => document.getElementById(`mill-settings-${key}`)!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }

it("guides pass/fail checks without unrelated numeric fields, and sends clear instructions", async () => {
  const fetcher = await mount("qc-specs"); click("Add a check"); await settle();
  expect(document.body.textContent).toContain("1. Where and what to check");
  expect(document.body.textContent).toContain("2. How to judge a pass");
  expect(document.getElementById("field-minValue")).toBeNull();
  type("code", "INSECTS"); type("name", "Live insects"); type("guidance", "No live insects in the sample");
  submit("qc-specs"); await settle();
  const write = fetcher.mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(JSON.parse(String(write[1]?.body))).toMatchObject({ point: "INCOMING_MAIZE", method: "VISUAL", resultType: "PASS_FAIL", minValue: null, maxValue: null, unit: null, guidance: "No live insects in the sample" });
});

it("shows numeric limits only for numeric readings and previews the passing rule", async () => {
  await mount("qc-specs"); click("Add a check"); await settle();
  await choose("resultType", "Reading against limits");
  expect(document.getElementById("field-minValue")).not.toBeNull();
  type("maxValue", "12.5"); type("unit", "%");
  expect(document.querySelector('[role="status"]')?.textContent).toContain("At most 12.5 %");
  await choose("resultType", "Pass or fail");
  expect(document.getElementById("field-maxValue")).toBeNull();
});

it("offers a real location creation form with site, type, code and capacity", async () => {
  const fetcher = await mount("locations"); click("Add a location"); await settle();
  await choose("siteId", "Mill site"); await choose("kind", "Bin");
  type("code", "BIN-NEW"); type("name", "New bin"); type("capacityKg", "5000");
  submit("locations"); await settle();
  const write = fetcher.mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(JSON.parse(String(write[1]?.body))).toEqual({ siteId: "site", code: "BIN-NEW", name: "New bin", kind: "BIN", capacityKg: "5000" });
});

it("offers product pickers for creating pack recipes", async () => {
  const fetcher = await mount("recipes"); click("Add a recipe"); await settle();
  await choose("packedProductId", "Meal 20 kg"); await choose("bulkProductId", "Meal bulk");
  type("kgPerBag", "20"); submit("recipes"); await settle();
  const write = fetcher.mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(JSON.parse(String(write[1]?.body))).toMatchObject({ packedProductId: "packed", bulkProductId: "bulk", kgPerBag: "20" });
});

it("keeps creation hidden for read-only users and points vehicle entry to Maintenance", async () => {
  access.edit = false; await mount("vehicles");
  expect(document.querySelector('a[href="/maintenance/equipment"]')).not.toBeNull();
  expect([...document.querySelectorAll("button")].some((node) => node.textContent === "Add a vehicle")).toBe(false);
  expect(document.querySelector('form')).toBeNull();
});
