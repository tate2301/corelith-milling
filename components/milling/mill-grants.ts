"use client";

import * as React from "react";

import { useMillAccess } from "@/components/milling/use-mill-access";
import type { MillCapability } from "@/lib/milling/access/groups";

/**
 * The mill's own grants on the shared frames, in the browser: `["ext:milling",
 * capability]` is held by whoever's groups give it; `view` by anyone who sees
 * the mill. The server answers the same way (extensions/milling/grants.ts).
 */
export function useMillGrants() {
  const access = useMillAccess();
  const data = access.data;
  return React.useCallback(
    (grant: readonly [string, string]) => {
      if (grant[0] !== "ext:milling" || !data) return false;
      if (grant[1] === "view") return data.canView;
      return data.capabilities.includes(grant[1] as MillCapability);
    },
    [data],
  );
}
