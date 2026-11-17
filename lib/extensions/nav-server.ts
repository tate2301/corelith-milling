import { registeredExtensionNav } from "@/extensions/nav-server";
import { canOpenFor } from "@/lib/nav/gate";
import { NAV_NODES } from "@/lib/nav/registry";

import type { ExtensionNavContext, ExtensionNavServer, ExtensionPersona } from "./server-types";

export type ExtensionNavWho = {
  role: string | null | undefined;
  enabledFeatures: string[] | undefined;
  workspaceProfile: string | null | undefined;
};

export type ExtensionNavReading = {
  badges: Record<string, string>;
  home: string | null;
  phone: string[];
};

/** How many rows the phone's bottom bar holds before More (`PHONE_DESTINATIONS`). */
const PHONE_ROWS = 4;

const ROW_IDS = new Set(NAV_NODES.flatMap((node) => [node.id, ...(node.kids ?? []).map((kid) => kid.id)]));

function inside(id: string, href: string): boolean {
  const path = href.split("?")[0] ?? href;
  return path === `/${id}` || path.startsWith(`/${id}/`);
}

/** One extension's figures, kept to its own addresses; a failing extension counts nothing rather than failing the sidebar. */
async function badgesOf(server: ExtensionNavServer, context: ExtensionNavContext): Promise<Record<string, string>> {
  if (!server.badges) return {};
  try {
    const badges = await server.badges(context);
    return Object.fromEntries(Object.entries(badges).filter(([href, value]) => inside(server.id, href) && value !== ""));
  } catch (error) {
    console.error(`[extensions] ${server.id} nav badges failed:`, error);
    return {};
  }
}

async function personaOf(server: ExtensionNavServer, context: ExtensionNavContext): Promise<ExtensionPersona | null> {
  if (!server.persona) return null;
  try {
    return await server.persona(context);
  } catch (error) {
    console.error(`[extensions] ${server.id} persona failed:`, error);
    return null;
  }
}

/**
 * What the registered extensions add to this person's sidebar: the counts on
 * their rows, the start page their role in the extension gives them, and the
 * rows on their phone bar. A start page they may not open, and a phone row
 * that does not exist, are dropped: the extension proposes, the gates decide.
 */
export async function readExtensionNav(
  context: ExtensionNavContext,
  who: ExtensionNavWho,
  servers: readonly ExtensionNavServer[] = registeredExtensionNav,
): Promise<ExtensionNavReading> {
  const reading: ExtensionNavReading = { badges: {}, home: null, phone: [] };
  if (servers.length === 0) return reading;
  const canOpen = canOpenFor(who);
  for (const server of servers) {
    Object.assign(reading.badges, await badgesOf(server, context));
    if (reading.home !== null || reading.phone.length > 0) continue;
    const persona = await personaOf(server, context);
    if (!persona) continue;
    if (persona.home && canOpen(persona.home)) reading.home = persona.home;
    reading.phone = [...new Set(persona.phone ?? [])].filter((id) => ROW_IDS.has(id)).slice(0, PHONE_ROWS);
  }
  return reading;
}
