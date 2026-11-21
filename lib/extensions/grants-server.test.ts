import { describe, expect, it, vi } from "vitest";

vi.mock("@/extensions/server", () => ({ registeredExtensionGrants: [] }));

import { extensionGrantChecks, extensionGrantHeld } from "./grants-server";

const who = { userId: "u1", companyId: "c1", role: "MANAGER" };

describe("an extension's own permissions on the shared frames", () => {
  it("answers ext grants from the extension that owns them, and nothing else", async () => {
    const checks = await extensionGrantChecks(who, [{ id: "milling", grants: async () => (action) => action === "intake.approve" }]);
    expect(extensionGrantHeld(checks, ["ext:milling", "intake.approve"])).toBe(true);
    expect(extensionGrantHeld(checks, ["ext:milling", "run.approve"])).toBe(false);
    // Another extension's grant, and a core grant, are not answered here.
    expect(extensionGrantHeld(checks, ["ext:bakery", "intake.approve"])).toBe(false);
    expect(extensionGrantHeld(checks, ["retail.sales", "view"])).toBe(false);
  });

  it("is read once per person, with who they are", async () => {
    const grants = vi.fn(async () => () => true);
    await extensionGrantChecks(who, [{ id: "milling", grants }]);
    expect(grants).toHaveBeenCalledTimes(1);
    expect(grants).toHaveBeenCalledWith(who);
  });

  it("grants nothing when an extension fails to answer", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const checks = await extensionGrantChecks(who, [{ id: "milling", grants: async () => { throw new Error("down"); } }]);
    expect(extensionGrantHeld(checks, ["ext:milling", "intake.approve"])).toBe(false);
    quiet.mockRestore();
  });

  it("refuses every ext grant in core, which registers none", async () => {
    expect(extensionGrantHeld(await extensionGrantChecks(who), ["ext:milling", "intake.approve"])).toBe(false);
  });
});
