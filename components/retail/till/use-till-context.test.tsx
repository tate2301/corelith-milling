// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SHOP_PROFILE, shopFeatures } from "@/lib/retail/shop-profile-rules";
import { useTillContext } from "./use-till-context";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let client: QueryClient;
afterEach(() => { act(() => root?.unmount()); client?.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

function Consumer({ paired }: { paired: boolean }) {
  const { data } = useTillContext(paired);
  return <div>{data ? String(shopFeatures(data.shop).ageCheck) : "Loading"}</div>;
}
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function mount(paired: boolean) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root.render(<QueryClientProvider client={client}><Consumer paired={paired} /></QueryClientProvider>));
}

describe("an open till's shop kind refresh", () => {
  it("stops asking for ID after a remote change to General retail, without reopening the till", async () => {
    vi.useFakeTimers();
    let businessType = "LIQUOR";
    const fetcher = vi.fn(async () => Response.json({ data: { shop: { ...DEFAULT_SHOP_PROFILE, businessType } } }));
    vi.stubGlobal("fetch", fetcher);
    mount(true); await tick(10);
    expect(document.body.textContent).toBe("true");
    businessType = "GENERAL";
    await tick(60_000);
    expect(document.body.textContent).toBe("false");
    expect(fetcher).toHaveBeenCalledTimes(2);
    // Switching back still restores configured liquor checks.
    businessType = "LIQUOR";
    await tick(60_000);
    expect(document.body.textContent).toBe("true");
  });

  it("does not poll or load device context on an unpaired device", async () => {
    vi.useFakeTimers(); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    mount(false); await tick(120_000);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
