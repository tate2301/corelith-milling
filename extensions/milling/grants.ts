import type { ExtensionGrantsServer } from "@/lib/extensions/server-types";
import { can, MILL_CAPABILITIES, type MillCapability } from "@/lib/milling/access/groups";
import { loadMillAccess } from "@/lib/milling/access/server";

/**
 * The mill's own permissions on the shared list and record frames: a grant
 * `["ext:milling", "<capability>"]` is held by whoever's mill groups give that
 * capability (lib/milling/access/groups.ts). `"view"` is held by anyone in a
 * mill group. Every mill API checks again.
 */
export const MILLING_GRANTS: ExtensionGrantsServer = {
  id: "milling",
  grants: async ({ userId, companyId, role }) => {
    const access = await loadMillAccess({ id: userId, companyId, role: role ?? "" });
    const known = new Set<string>(MILL_CAPABILITIES);
    return (action) => (action === "view" ? access.canView : known.has(action) && can(access, action as MillCapability));
  },
};
