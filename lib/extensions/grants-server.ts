import { registeredExtensionGrants } from "@/extensions/server";

import type { ExtensionGrantsServer, ExtensionNavContext } from "./server-types";

/** Each extension's answer for one person, by extension id: `{ milling: (action) => boolean }`. */
export type ExtensionGrantChecks = Readonly<Record<string, (action: string) => boolean>>;

/**
 * Reads every registered extension's permissions for this person, once. An
 * extension that fails to answer grants nothing rather than failing the page.
 */
export async function extensionGrantChecks(
  context: ExtensionNavContext,
  servers: readonly ExtensionGrantsServer[] = registeredExtensionGrants,
): Promise<ExtensionGrantChecks> {
  const entries = await Promise.all(
    servers.map(async (server) => {
      try {
        return [server.id, await server.grants(context)] as const;
      } catch (error) {
        console.error(`[extensions] ${server.id} grants`, error);
        return [server.id, () => false] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

/** Whether a grant written `["ext:<id>", action]` is held; any other grant is not this function's to answer. */
export function extensionGrantHeld(checks: ExtensionGrantChecks, grant: readonly [string, string]): boolean {
  if (!grant[0].startsWith("ext:")) return false;
  const check = checks[grant[0].slice(4)];
  return check ? check(grant[1]) : false;
}
