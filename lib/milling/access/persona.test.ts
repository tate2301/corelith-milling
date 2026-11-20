import { describe, expect, it } from "vitest";

import { NAV_NODES } from "@/lib/nav/registry";

import { millPersonaFor } from "./persona";

const ROWS = new Set(NAV_NODES.flatMap((node) => [node.id, ...(node.kids ?? []).map((kid) => kid.id)]));

describe("where each person starts (NV03)", () => {
  it("opens the Mill Manager on Overview with Intake, Runs and Quality on the phone", () => {
    expect(millPersonaFor("CLERK", { groups: ["MANAGEMENT"] })).toEqual({
      home: "/milling",
      phone: ["milling.home", "milling.intake", "milling.runs", "milling.quality"],
    });
  });

  it("opens a supervisor on Runs, a QC technician on Quality and stores on Intake", () => {
    expect(millPersonaFor("CLERK", { groups: ["SUPERVISOR"] })?.home).toBe("/milling/production");
    expect(millPersonaFor("CLERK", { groups: ["QUALITY"] })?.home).toBe("/milling/quality");
    expect(millPersonaFor("CLERK", { groups: ["STORES"] })?.home).toBe("/milling/intake");
  });

  it("opens a sales rep on today's route and the director on yesterday at a glance", () => {
    expect(millPersonaFor("CLERK", { groups: ["SALES_REP"] })?.home).toBe("/milling/rep");
    expect(millPersonaFor("CLERK", { groups: ["DIRECTOR"] })?.home).toBe("/milling/director");
  });

  it("uses the main job when a person holds several groups", () => {
    expect(millPersonaFor("CLERK", { groups: ["DRIVER", "STORES"] })?.home).toBe("/milling/intake");
  });

  it("starts the workspace's managers as the Mill Manager, the accountant on Money, and leaves others to core", () => {
    expect(millPersonaFor("MANAGER", { groups: [] })?.home).toBe("/milling");
    expect(millPersonaFor("FINANCE_OFFICER", { groups: [] })?.home).toBe("/books");
    expect(millPersonaFor("CLERK", { groups: [] })).toBeNull();
  });

  it("names only rows the sidebar has, at most four", () => {
    for (const groups of [["MANAGEMENT"], ["SUPERVISOR"], ["QUALITY"], ["DISPATCH"], ["STORES"], ["OPERATOR"], ["DRIVER"], ["SALES_REP"], ["DIRECTOR"], ["ADMIN"]] as const) {
      const phone = millPersonaFor("CLERK", { groups: [...groups] })?.phone ?? [];
      expect(phone.length).toBeLessThanOrEqual(4);
      for (const id of phone) expect(ROWS.has(id), `${groups[0]}: ${id}`).toBe(true);
    }
    for (const id of millPersonaFor("FINANCE_OFFICER", { groups: [] })?.phone ?? []) expect(ROWS.has(id)).toBe(true);
  });
});
