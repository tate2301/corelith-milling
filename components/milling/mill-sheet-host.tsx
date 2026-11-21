"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useMillGrants } from "@/components/milling/mill-grants";
import { SheetForm } from "@/components/sheet-form/sheet-form";
import { MILL_SHEETS } from "@/lib/milling/sheets";
import { canRetailRoleDo, type RetailAction, type RetailResource } from "@/lib/retail/permission-matrix";
import type { SheetCtx, SheetKind } from "@/lib/workspace/sheet-kind";

/** The sheet's own parameters, taken out of the address when it closes. */
const SHEET_PARAMS = ["sheet", "id", "ids", "step"];

function withoutSheet(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  for (const key of SHEET_PARAMS) params.delete(key);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * The mill's sheets, drawn by core's SheetForm exactly as Retail's are: the
 * address `?sheet=mill-…` opens one over the page (refresh reopens it, Back
 * closes it). Core's own host leaves these keys alone; this one answers the
 * mill's grants from the person's groups.
 */
export function MillSheetHost() {
  return (
    <React.Suspense fallback={null}>
      <Host />
    </React.Suspense>
  );
}

function Host() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const { data: session } = useSession();
  const millCan = useMillGrants();
  const userId = session?.user?.id ?? null;
  const userName = session?.user?.name ?? "";
  const role = session?.user?.role ?? "";

  const key = searchParams.get("sheet");
  const kind: SheetKind | undefined = key ? MILL_SHEETS[key] : undefined;

  const ctx = React.useMemo<SheetCtx | null>(() => {
    if (!userId) return null;
    const params = new URLSearchParams(search);
    return {
      params,
      id: params.get("id"),
      user: { id: userId, name: userName, role },
      can: (resource, action) => (resource.startsWith("ext:") ? millCan([resource, action]) : canRetailRoleDo(role, resource as RetailResource, action as RetailAction)),
    };
  }, [search, userId, userName, role, millCan]);

  const allowed = Boolean(kind && ctx && kind.requires.some(([resource, action]) => ctx.can(resource, action)));
  const openKey = allowed && key ? `${key}|${ctx?.id ?? ""}` : null;

  // Each opening is a fresh sheet; one opened by a click here closes with Back.
  const [seen, setSeen] = React.useState<{ openKey: string | null; pathname: string | null; hadSheet: boolean; openedHere: boolean; shown: { key: string; kind: SheetKind; round: number } | null }>({
    openKey: null,
    pathname: null,
    hadSheet: false,
    openedHere: false,
    shown: null,
  });
  if (openKey !== seen.openKey || pathname !== seen.pathname) {
    const opening = openKey !== null && (openKey !== seen.openKey || pathname !== seen.pathname);
    setSeen({
      openKey,
      pathname,
      hadSheet: key !== null,
      openedHere: opening ? seen.pathname === pathname && !seen.hadSheet : openKey ? seen.openedHere : false,
      shown: opening && kind && key ? { key, kind, round: (seen.shown?.round ?? 0) + 1 } : seen.shown,
    });
  }
  const [lastCtx, setLastCtx] = React.useState<SheetCtx | null>(null);
  if (openKey && ctx && ctx !== lastCtx) setLastCtx(ctx);

  const openedHere = seen.openedHere;
  const close = React.useCallback(() => {
    if (openedHere) router.back();
    else router.replace(withoutSheet(pathname, window.location.search.slice(1)), { scroll: false });
  }, [openedHere, pathname, router]);

  const sheetCtx = (openKey ? ctx : null) ?? lastCtx;
  if (!seen.shown || !sheetCtx) return null;
  return <SheetForm key={`${seen.shown.key}:${seen.shown.round}`} kind={seen.shown.kind} ctx={sheetCtx} open={openKey !== null && key === seen.shown.key} onClose={close} />;
}
