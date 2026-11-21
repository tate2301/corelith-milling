import type { ListGrant } from "@/lib/reports/types";

/**
 * What every mill list shares: the mill's feature and area, and its grants.
 * A grant `["ext:milling", capability]` is held by whoever's mill groups give
 * that capability (extensions/milling/grants.ts); `view` by anyone in a group.
 */
export const LIST_BASE: { featureKey: string; profiles: string[]; area: string } = { featureKey: "milling.home", profiles: ["GENERAL"], area: "The mill" };

export const MILL_VIEW: ListGrant[] = [["ext:milling", "view"]];
export const mill = (...capabilities: string[]): ListGrant[] => capabilities.map((capability) => ["ext:milling", capability] as ListGrant);
