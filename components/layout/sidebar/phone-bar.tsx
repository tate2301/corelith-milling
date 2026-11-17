"use client";

import * as React from "react";
import Link from "next/link";

import { NAV_ICONS } from "@/lib/icons/corelith-nav.generated";
import type { ComposedGroup, ComposedNode } from "@/lib/nav/compose";
import type { ActiveNav } from "@/lib/nav/match";
import { arrange, type NavPrefs } from "@/lib/nav/prefs";
import { cn } from "@/lib/utils";

import { ChromeIcon } from "./parts";
import styles from "./phone-bar.module.css";

/** How many destinations the bar holds before More. */
export const PHONE_DESTINATIONS = 4;

/**
 * The phone's bottom bar: four destinations and More, which opens the same
 * tree as the sidebar does (the drawer). The destinations are the rows an
 * extension chose for this person's part of the trade (`rows`), when it chose
 * any they may open; otherwise their pinned pages, then the first pages of the
 * sidebar.
 */
export function PhoneBar({
  groups,
  active,
  prefs,
  badges = {},
  moreOpen = false,
  rows = null,
  onMore,
}: {
  groups: ComposedGroup[];
  /** Rows by id, a node's or a child's, in order (`ShellNav.phoneRows`). */
  rows?: readonly string[] | null;
  active: ActiveNav | null;
  prefs: NavPrefs;
  badges?: Record<string, string>;
  moreOpen?: boolean;
  onMore: () => void;
}) {
  const arranged = React.useMemo(() => arrange(groups, prefs, active?.nodeId ?? null), [groups, prefs, active?.nodeId]);
  const chosen = React.useMemo(() => chosenRows(groups, rows), [groups, rows]);
  const nodes =
    chosen.length > 0
      ? chosen
      : [...arranged.pinned, ...arranged.groups.flatMap((group) => group.items)].slice(0, PHONE_DESTINATIONS);
  const isHere = (node: ComposedNode) =>
    node.id === (active?.kidId && chosen.some((row) => row.id === active.kidId) ? active.kidId : active?.nodeId);
  const inBar = nodes.some(isHere);
  return (
    <nav className={styles.bar} aria-label="Main" data-phone-bar="">
      {nodes.map((node) => {
        const Icon = NAV_ICONS[node.icon];
        const here = !moreOpen && isHere(node);
        const waiting = Boolean(badges[node.href]) || node.kids.some((kid) => Boolean(badges[kid.href]));
        return (
          <Link key={node.id} href={node.href} className={cn(styles.tab, here && styles.current)} aria-current={here ? "page" : undefined}>
            {Icon ? <Icon width={20} height={20} aria-hidden="true" /> : null}
            <span className={styles.name}>{node.label}</span>
            {waiting ? <span className={styles.dot} aria-hidden="true" /> : null}
          </Link>
        );
      })}
      <button
        type="button"
        className={cn(styles.tab, (moreOpen || (!inBar && active)) && styles.current)}
        aria-expanded={moreOpen}
        onClick={onMore}
      >
        <ChromeIcon name="more" />
        <span className={styles.name}>More</span>
      </button>
    </nav>
  );
}

/** The chosen rows this person may open, as bar destinations: a child stands on its own, without its siblings. */
function chosenRows(groups: ComposedGroup[], rows: readonly string[] | null): ComposedNode[] {
  if (!rows?.length) return [];
  const found = new Map<string, ComposedNode>();
  for (const group of groups) {
    for (const node of group.items) {
      found.set(node.id, node);
      for (const kid of node.kids) found.set(kid.id, { ...kid, group: node.group, kids: [] });
    }
  }
  return rows.flatMap((id) => found.get(id) ?? []).slice(0, PHONE_DESTINATIONS);
}
