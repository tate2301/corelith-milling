import { describe, expect, it, vi } from "vitest";

vi.mock("@/extensions/server", () => ({ registeredExtensionGrants: [], registeredExtensionLoaders: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { listContext } from "./request";

const session = { user: { id: "u1", companyId: "c1", role: "MANAGER", enabledFeatures: [] } } as unknown as Parameters<typeof listContext>[0];

describe("a list's grants written for an extension", () => {
  it("are answered by the extension's checks", () => {
    const ctx = listContext(session, new Date(), { milling: (action) => action === "intake.approve" });
    expect(ctx.can(["ext:milling", "intake.approve"])).toBe(true);
    expect(ctx.can(["ext:milling", "run.approve"])).toBe(false);
    expect(ctx.can(["ext:bakery", "intake.approve"])).toBe(false);
  });

  it("are refused when no checks were read", () => {
    expect(listContext(session).can(["ext:milling", "intake.approve"])).toBe(false);
  });
});
