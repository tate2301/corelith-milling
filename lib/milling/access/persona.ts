import type { ExtensionPersona } from "@/lib/extensions/server-types";

import type { MillAccess, MillGroupCode } from "./groups";

/**
 * Where each person starts and what their phone bar holds (canvas NV03,
 * "Home, rail and phone bar"). A person in several groups gets the first one
 * in this order: the job they spend most of the day on.
 *
 * Phone rows are sidebar row ids, the mill's or core's, at most four; More
 * holds the rest.
 */
const PERSONAS: ReadonlyArray<{ group: MillGroupCode; persona: Required<ExtensionPersona> }> = [
  { group: "MANAGEMENT", persona: { home: "/milling", phone: ["milling.home", "milling.intake", "milling.runs", "milling.quality"] } },
  { group: "SUPERVISOR", persona: { home: "/milling/production", phone: ["milling.runs", "milling.packing", "milling.downtime", "attendance"] } },
  { group: "QUALITY", persona: { home: "/milling/quality", phone: ["milling.quality", "milling.runs", "milling.intake"] } },
  { group: "DISPATCH", persona: { home: "/milling/deliveries", phone: ["milling.deliveries", "milling.trips", "milling.sellers", "milling.orders"] } },
  { group: "STORES", persona: { home: "/milling/intake", phone: ["milling.intake", "onhand", "counts", "milling.lots"] } },
  { group: "OPERATOR", persona: { home: "/milling/production", phone: ["milling.runs", "milling.downtime"] } },
  { group: "DRIVER", persona: { home: "/milling/deliveries", phone: ["milling.deliveries"] } },
  { group: "ADMIN", persona: { home: "/milling/settings/general", phone: ["milling.home", "milling.settings"] } },
];

/** The workspace's owners and managers start where the Mill Manager does. */
const MANAGER_ROLES = new Set(["SUPERADMIN", "MANAGER"]);

/** The accountant opens on Money (NV03), which is core's Books. */
const ACCOUNTANT_ROLES = new Set(["FINANCE_OFFICER"]);

export function millPersonaFor(role: string | null, access: Pick<MillAccess, "groups">): ExtensionPersona | null {
  for (const { group, persona } of PERSONAS) {
    if (access.groups.includes(group)) return { home: persona.home, phone: [...persona.phone] };
  }
  if (role && MANAGER_ROLES.has(role)) return millPersonaFor(null, { groups: ["MANAGEMENT"] });
  if (role && ACCOUNTANT_ROLES.has(role)) return { home: "/books", phone: ["money", "milling.reports"] };
  return null;
}
