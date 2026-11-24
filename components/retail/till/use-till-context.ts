"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchJson } from "@/lib/api-client";
import type { TillContext } from "@/lib/retail/devices";

/** The same persisted key keeps the last known context available offline. */
export const TILL_CONTEXT_KEY = ["till-context"] as const;

/** Refresh shop-kind/age-check settings even when an online till stays open on another device. */
export function useTillContext(paired: boolean) {
  return useQuery({
    queryKey: TILL_CONTEXT_KEY,
    queryFn: async () => (await fetchJson<{ data: TillContext }>("/api/v2/retail/devices/me")).data,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    enabled: paired,
  });
}
