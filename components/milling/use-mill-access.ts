"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchJson } from "@/lib/api-client";
import type { MillAccess, MillCapability } from "@/lib/milling/access/groups";

/** The signed-in person's mill access (`/api/milling/me`), for showing only the actions they may take. */
export function useMillAccess() {
  const query = useQuery({
    queryKey: ["milling", "me"],
    queryFn: () => fetchJson<MillAccess>("/api/milling/me"),
    staleTime: 60_000,
  });
  const capabilities = query.data?.capabilities ?? [];
  return {
    ...query,
    can: (capability: MillCapability) => capabilities.includes(capability),
  };
}
