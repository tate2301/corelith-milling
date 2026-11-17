import { afterEach, describe, expect, it, vi } from "vitest";
import type { SheetCtx } from "@/lib/workspace/sheet-kind";

import { PRODUCT_SHEETS } from "./products";

const ctx: SheetCtx = { params: new URLSearchParams(), id: null, user: { id: "u", name: "Owner", role: "SUPERADMIN" }, can: () => true };
const sheet = PRODUCT_SHEETS["price-list-new"]!;
const empty = { id: "empty", label: "Empty list", sub: "Set prices for each product" };

afterEach(() => { vi.unstubAllGlobals(); });

describe("New price list without an existing source", () => {
  it("loads the empty option offered for a workspace without lists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ options: [empty, { id: "cost", label: "Cost" }] }) }));
    expect(await sheet.load!(ctx)).toEqual({ startFrom: empty });
  });

  it("still prefers the default when there are existing lists", async () => {
    const defaultList = { id: "default", label: "Retail", sub: "Default, 0 products" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ options: [defaultList, empty] }) }));
    expect(await sheet.load!(ctx)).toEqual({ startFrom: defaultList });
  });

  it("sends an explicit empty start and ignores stale percentage values", () => {
    const request = sheet.submit({ name: "Mill prices", startFrom: empty, prices: "% off", by: "10%", switchOn: true }, ctx);
    expect(request).toMatchObject({ body: { startFrom: { empty: true }, prices: "SAME", by: null, audience: "EVERYONE", when: "ALWAYS", siteId: null, switchOn: true } });
    const fields = sheet.sections.flatMap((section) => section.fields);
    expect(fields.find((field) => field.id === "prices")!.show!({ startFrom: empty }, ctx)).toBe(false);
    expect(fields.find((field) => field.id === "by")!.show!({ startFrom: empty, prices: "% off" }, ctx)).toBe(false);
  });

  it("preserves list-copy and cost request shapes", () => {
    for (const [id, startFrom] of [["cost", { cost: true }], ["existing", { listId: "existing" }]] as const) {
      expect(sheet.submit({ startFrom: { id, label: id }, prices: "% off", by: "5%" }, ctx)).toMatchObject({ body: { startFrom, prices: "OFF", by: "5%" } });
    }
  });
});
