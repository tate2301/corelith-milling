"use client";

import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";

import { Skeleton } from "@/components/ui/skeleton";

const subscribe = () => () => {};

/**
 * The mill's screens draw from queries the app restores from the device's
 * cache, and that restore can land before React hydrates. A screen drawn on
 * the server (no cache) and again on the client (cache restored) would then
 * disagree. Until the page has mounted both sides draw the same skeleton;
 * after it, the screen draws with whatever the cache holds and refreshes.
 */
export default function MillLayout({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (!mounted) return <Skeleton className="m-4 h-96" />;
  return <>{children}</>;
}
