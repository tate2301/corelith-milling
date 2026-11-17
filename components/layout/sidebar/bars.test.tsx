// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { composeNav } from "@/lib/nav/compose";
import { activeNav } from "@/lib/nav/match";
import { NO_PREFS } from "@/lib/nav/prefs";

import { PhoneBar, PHONE_DESTINATIONS } from "./phone-bar";
import { Rail } from "./rail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const groups = composeNav({ canOpen: () => true });
const nodes = groups.flatMap((group) => group.items);

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});
function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

describe("PhoneBar", () => {
  it("holds four destinations and More", () => {
    const onMore = vi.fn();
    mount(<PhoneBar groups={groups} active={null} prefs={NO_PREFS} onMore={onMore} />);
    expect(host!.querySelectorAll("a")).toHaveLength(PHONE_DESTINATIONS);
    const more = [...host!.querySelectorAll("button")].find((b) => b.textContent === "More")!;
    act(() => more.click());
    expect(onMore).toHaveBeenCalled();
  });

  it("puts a pinned page first", () => {
    const pick = nodes[8]!;
    mount(<PhoneBar groups={groups} active={null} prefs={{ ...NO_PREFS, pinned: [pick.id] }} onMore={() => {}} />);
    expect(host!.querySelector("a")?.textContent).toBe(pick.label);
  });
});

describe("PhoneBar with rows an extension chose", () => {
  const parent = nodes.find((node) => node.kids.length > 1)!;
  const kid = parent.kids[1]!;
  const other = nodes.find((node) => node.id !== parent.id)!;

  it("holds the chosen rows in order, a child standing on its own, skipping rows not drawn", () => {
    mount(<PhoneBar groups={groups} active={null} prefs={NO_PREFS} rows={[kid.id, "nowhere", other.id]} onMore={() => {}} />);
    expect([...host!.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([kid.href, other.href]);
  });

  it("marks a chosen child as the page, not its parent", () => {
    const active = { nodeId: parent.id, kidId: kid.id, href: kid.href, label: kid.label, icon: kid.icon };
    mount(<PhoneBar groups={groups} active={active} prefs={NO_PREFS} rows={[parent.id, kid.id]} onMore={() => {}} />);
    const current = [...host!.querySelectorAll("a")].filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.getAttribute("href"))).toEqual([kid.href]);
  });

  it("falls back to the usual four when none of the rows is drawn", () => {
    mount(<PhoneBar groups={groups} active={null} prefs={NO_PREFS} rows={["nowhere"]} onMore={() => {}} />);
    expect(host!.querySelectorAll("a")).toHaveLength(PHONE_DESTINATIONS);
  });
});

describe("Rail", () => {
  it("has a mark for each top-level page, a hairline per group, and opens the sidebar", () => {
    const onOpen = vi.fn();
    mount(
      <Rail
        groups={groups}
        active={activeNav(groups, "/", null)}
        prefs={NO_PREFS}
        badges={{}}
        switcher={<i />}
        management={{ href: "/preferences/organization", current: false }}
        onOpen={onOpen}
      />,
    );
    const marks = [...host!.querySelectorAll("a[aria-label]")].filter((a) => a.getAttribute("aria-label") !== "Management");
    expect(marks).toHaveLength(nodes.length);
    expect(host!.querySelector('a[aria-label="Management"]')).toBeTruthy();
    act(() => host!.querySelector<HTMLButtonElement>('button[aria-label="Open the sidebar, ["]')!.click());
    expect(onOpen).toHaveBeenCalled();
  });
});
