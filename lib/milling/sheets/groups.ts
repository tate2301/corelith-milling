import { fetchJson } from "@/lib/api-client";
import { MILL_GROUPS, type MillGroupCode } from "@/lib/milling/access/groups";
import type { MillMemberRow } from "@/lib/milling/access/membership";
import type { SheetKind } from "@/lib/workspace/sheet-kind";

/** Put one person in exactly the mill groups ticked; each group says what it lets them do. */
const personGroups: SheetKind = {
  title: (_ctx, values) => (values._name ? `Groups for ${String(values._name)}` : "Groups"),
  sub: (_ctx, values) => (values._everything ? "An owner or manager may do everything at the mill; groups still say who is asked to decide." : "Tick each group this person works in. One person may hold several."),
  cur: "US$",
  load: async (ctx) => {
    const data = await fetchJson<{ members: MillMemberRow[] }>("/api/milling/groups");
    const member = data.members.find((row) => row.userId === ctx.id);
    return {
      _name: member?.name ?? "",
      _everything: member ? member.role === "SUPERADMIN" || member.role === "MANAGER" : false,
      ...Object.fromEntries(MILL_GROUPS.map((group) => [group.code, member?.groups.includes(group.code) ?? false])),
    };
  },
  sections: [
    {
      fields: MILL_GROUPS.map((group) => ({ id: group.code, t: "toggle" as const, l: group.name, h: group.description, opt: true, optQuiet: true })),
    },
  ],
  note: "",
  primary: "Save",
  done: () => "Groups saved",
  submit: (values, ctx) => ({
    method: "PUT",
    url: "/api/milling/groups",
    body: { userId: ctx.id, groups: MILL_GROUPS.filter((group) => values[group.code] === true).map((group) => group.code as MillGroupCode) },
  }),
  invalidate: [["list"], ["milling"]],
  requires: [["ext:milling", "settings.manage"]],
};

export const GROUP_SHEETS: Record<string, SheetKind> = { "mill-person-groups": personGroups };
