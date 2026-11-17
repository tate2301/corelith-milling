import type { ExtensionNavServer } from "@/lib/extensions/server-types";

/**
 * Server-only sidebar parts of this deployment's extensions: the counts on
 * their rows, and each person's start page and phone bar
 * (`ExtensionNavServer`). Empty in core.
 *
 * Like `extensions/index.ts` and `extensions/server.ts`, core never edits
 * this file after creating it, so a fork's one line here never conflicts
 * with a core sync:
 *
 *   import { MILLING_NAV } from "./milling/nav-server";
 *   export const registeredExtensionNav: readonly ExtensionNavServer[] = [MILLING_NAV];
 */
export const registeredExtensionNav: readonly ExtensionNavServer[] = [];
