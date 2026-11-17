import { registeredExtensions } from "@/extensions";
import { isRouteAllowedForRole } from "@/lib/auth-core/role-routes";
import {
  extensionManagementLinks,
  extensionNavAdditionPrefixes,
  extensionNavAddresses,
  extensionNavGroups,
} from "@/lib/extensions/registry";
import { getVisibleSettingsNavEntries } from "@/lib/settings/management-nav";
import { composeManagement } from "./management";
import { canAccessRouteWithToken } from "@/lib/platform/gating/enforcer";
import { resolveFeatureKeyForPath } from "@/lib/platform/gating/route-registry";
import { getWorkspaceOptions, getWorkspaceSidebarModel } from "@/lib/workspaces";

import type { NavGroupId } from "./registry";

type Who = {
  role: string | null | undefined;
  enabledFeatures: string[] | undefined;
  workspaceProfile: string | null | undefined;
};

const pathOf = (href: string) => href.split("?")[0] ?? href;

/**
 * Every address this person may open, as the sidebar they have today draws it.
 *
 * The existing model already asks every check there is (the feature for the
 * route, the role's route limits, retail grants, campus grants, Books'
 * visibility), so the new sidebar asks it rather than keeping a second copy
 * that could drift. Taken across every workspace the tenant has, because the
 * new sidebar does not split by product. This is the bridge until the checks
 * move out of `getWorkspaceSidebarModel` (BUILD.md, phase 10).
 */
export function visibleAddresses(who: Who): Set<string> {
  const seen = new Set<string>();
  for (const workspace of getWorkspaceOptions(who)) {
    const model = getWorkspaceSidebarModel({ ...who, activeWorkspaceId: workspace.id });
    for (const section of model.sections) {
      for (const item of section.items) seen.add(item.href);
    }
  }
  for (const href of extensionNavAddresses(registeredExtensions)) {
    if (extensionAddressOpens(who, href)) seen.add(href);
  }
  return seen;
}

/**
 * An extension's row shows when the proxy would let this person in: the
 * address is gated on a feature (an ungated address never shows), the
 * workspace has it with its dependencies, and the role may reach it.
 */
function extensionAddressOpens(who: Who, href: string): boolean {
  const path = pathOf(href);
  if (!resolveFeatureKeyForPath(path)) return false;
  return canAccessRouteWithToken(path, who.enabledFeatures).allowed && isRouteAllowedForRole(who.role, path);
}

/** The price each locked page shows, by address: Books' pages the workspace's plan does not include. */
export function lockedAddresses(who: Who): Map<string, string> {
  const locks = new Map<string, string>();
  for (const workspace of getWorkspaceOptions(who)) {
    const model = getWorkspaceSidebarModel({ ...who, activeWorkspaceId: workspace.id });
    for (const section of model.sections) {
      for (const item of section.items) if (item.lock) locks.set(pathOf(item.href), item.lock);
    }
  }
  return locks;
}

const MANAGEMENT_LINKS = extensionManagementLinks(registeredExtensions);

/**
 * The extension rows that open a Management row this person may open: such a
 * row shows exactly when Management shows its row (`composeManagement`).
 */
function managementLinksOpen(who: Who, open: (href: string) => boolean): Set<string> {
  if (MANAGEMENT_LINKS.size === 0) return new Set();
  const settings = new Set(getVisibleSettingsNavEntries(who).map((entry) => entry.id));
  const rows = new Set(composeManagement({ settings, canOpen: open }).flatMap((group) => group.items.map((item) => item.id)));
  return new Set([...MANAGEMENT_LINKS].filter(([, id]) => rows.has(id)).map(([href]) => href));
}

/** `canOpen` for `composeNav`: a page with a query is open when its path is. */
export function canOpenFor(who: Who): (href: string) => boolean {
  const open = visibleAddresses(who);
  const paths = new Set([...open].map(pathOf));
  const base = (href: string) => open.has(href) || paths.has(pathOf(href));
  const management = managementLinksOpen(who, base);
  return (href) => base(href) || management.has(href);
}

const CORE_PRODUCT_PREFIXES: Array<[NavGroupId, string[]]> = [
  ["tender", ["/retail"]],
  ["crm", ["/crm"]],
  ["campus", ["/schools"]],
  ["huchu", ["/gold", "/maintenance"]],
];

/** Each product group and the addresses that mean a workspace runs it; a row an extension adds to a core product group counts for it. */
const PRODUCT_PREFIXES: Array<[NavGroupId, string[]]> = [
  ...CORE_PRODUCT_PREFIXES.map(([id, prefixes]): [NavGroupId, string[]] => [
    id,
    [
      ...prefixes,
      ...extensionNavAdditionPrefixes(registeredExtensions)
        .filter(([group]) => group === id)
        .flatMap(([, paths]) => paths),
    ],
  ]),
  ...extensionNavGroups(registeredExtensions).map(({ id, prefixes }): [NavGroupId, string[]] => [id, prefixes]),
];

/**
 * The product groups this person's workspace runs, the tenant's own first.
 * `profile` is the stored workspace profile (SCHOOLS, GOLD_MINE, RETAIL, ...).
 * A registered extension's group is the tenant's own when no core profile
 * claims the workspace: a fork cell runs its vertical on a GENERAL profile.
 */
export function productGroupsFor(open: Set<string>, profile: string | null | undefined): NavGroupId[] {
  const own: Record<string, NavGroupId> = { SCHOOLS: "campus", GOLD_MINE: "huchu", RETAIL: "tender" };
  const running = PRODUCT_PREFIXES.filter(([, prefixes]) =>
    [...open].some((href) => prefixes.some((prefix) => pathOf(href) === prefix || pathOf(href).startsWith(`${prefix}/`))),
  ).map(([id]) => id);
  const first = own[String(profile ?? "").toUpperCase()] ?? running.find((id) => id.startsWith("ext."));
  return first && running.includes(first) ? [first, ...running.filter((id) => id !== first)] : running;
}

export type NavLayout = {
  products: NavGroupId[];
  order: NavGroupId[];
  labels: Record<string, string>;
  groupLabels: Partial<Record<NavGroupId, string>>;
};

/**
 * How this workspace's sidebar is laid out: its product groups and, when an
 * extension's product is the tenant's own, that extension's group order and
 * trade words (`nav.order`, `nav.labels`). What shows is still `canOpen`'s.
 */
export function navLayoutFor(open: Set<string>, profile: string | null | undefined): NavLayout {
  const products = productGroupsFor(open, profile);
  const own = registeredExtensions.find((extension) => products[0] === `ext.${extension.id}`);
  return {
    products,
    order: [...(own?.nav?.order ?? [])],
    labels: { ...own?.nav?.labels?.rows },
    groupLabels: { ...own?.nav?.labels?.groups },
  };
}
