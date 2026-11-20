import type { ExtensionPayrollServer } from "@/lib/extensions/server-types";

/**
 * Earnings this deployment's extensions add to pay runs (`ExtensionPayrollServer`),
 * such as a trade's commission. Empty in core.
 *
 * Like `extensions/index.ts`, `extensions/server.ts` and
 * `extensions/nav-server.ts`, core never edits this file after creating it,
 * so a fork's one line here never conflicts with a core sync:
 *
 *   import { MILLING_PAYROLL } from "./milling/payroll-server";
 *   export const registeredExtensionPayroll: readonly ExtensionPayrollServer[] = [MILLING_PAYROLL];
 */
export const registeredExtensionPayroll: readonly ExtensionPayrollServer[] = [];
