import { describe, expect, it, vi } from "vitest";

// A Server Component cannot read tab data exported by a "use client" module.
vi.mock("@/components/milling/settings-shell", () => ({
  get MILL_SETTINGS_TABS() {
    throw new Error("The server redirect must not read client-module exports");
  },
}));

const { default: MillSettingsPage } = await import("./page");

describe("Mill settings entry route", () => {
  it("redirects to general settings without reading client-only tab data", () => {
    expect(() => MillSettingsPage()).toThrowError(
      expect.objectContaining({
        digest: "NEXT_REDIRECT;replace;/milling/settings/general;307;",
      }),
    );
  });
});
