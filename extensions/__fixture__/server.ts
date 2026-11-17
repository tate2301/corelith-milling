import type { ExtensionNavServer } from "@/lib/extensions/server-types";
import type { ReportLoader } from "@/lib/reports/types";

/** The fixture's report loaders, registered in place of `extensions/server.ts` by the contract test. */
export const FIXTURE_LOADERS: Record<string, ReportLoader> = {
  "fixture-runs": { load: async () => ({ rows: [{ id: "R-1", run: "R-1" }], truncated: false }) },
};

/** The fixture's sidebar figures and per-person start: a manager starts on runs, with two rows on the phone. */
export const FIXTURE_NAV: ExtensionNavServer = {
  id: "fixture",
  badges: async () => ({ "/fixture/runs": "3", "/retail/stock": "9" }),
  persona: async ({ role }) =>
    role === "MANAGER" ? { home: "/fixture/runs", phone: ["fixture.runs-open", "fixture.till", "nowhere"] } : null,
};
