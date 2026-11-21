import { z } from "zod";

import { fetchJson } from "@/lib/api-client";
import type { SheetKind } from "@/lib/workspace/sheet-kind";

import { idOf, labels, numberOf, text } from "./choices";

type Machine = { id: string; equipmentCode: string; name: string; category?: string | null };

const CATEGORY: Record<string, string> = { Breakdown: "BREAKDOWN", Power: "POWER", "No maize": "MATERIAL", Planned: "PLANNED", Other: "OTHER" };

/** The mill's clock, a wall-clock "YYYY-MM-DDTHH:mm": Zimbabwe is UTC+2 all year. */
const nowLocal = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
};
const iso = (value: unknown) => (typeof value === "string" && value ? new Date(`${value}:00+02:00`).toISOString() : undefined);

/** Log downtime (DT-A2): the machine, what stopped and since when. A breakdown takes the machine out of use and raises a work order. */
const stopNew: SheetKind = {
  title: "Log downtime",
  sub: "A breakdown takes the machine out of use, raises a work order for the workshop, and needs a supervisor to release it.",
  cur: "US$",
  load: async () => {
    const machines = await fetchJson<Machine[]>("/api/milling/equipment");
    return { _machine: machines.map((machine) => ({ id: machine.id, label: `${machine.equipmentCode} · ${machine.name}` })), category: "Breakdown", machine: "None", since: nowLocal() };
  },
  sections: [
    {
      fields: [
        { id: "category", t: "seg", l: "Category", o: Object.keys(CATEGORY) },
        { id: "machine", t: "text", l: "Machine", o: (values) => labels(values, "machine", values.category !== "Breakdown"), needed: "Choose the machine that broke down." },
        { id: "cause", t: "text", l: "What happened", p: "Sift box jammed", needed: "Say what stopped.", schema: z.string().trim().min(3, "Say what stopped.") },
        { id: "since", t: "datetime", l: "Since", latest: "today" },
      ],
    },
  ],
  note: "",
  primary: "Log it",
  done: "Downtime logged",
  submit: (values) => ({
    method: "POST",
    url: "/api/milling/downtime",
    body: { category: CATEGORY[String(values.category)] ?? "OTHER", equipmentId: idOf(values, "machine"), cause: text(values.cause), startedAt: iso(values.since) },
  }),
  invalidate: [["list"], ["milling"]],
  requires: [["ext:milling", "fault.report"]],
};

/** Log a generator run (DT-B2): when it ran, its hour meter, the diesel and why. */
const generatorRun: SheetKind = {
  title: "Log a generator run",
  sub: "Its hours and diesel go to the generator log and the fuel report.",
  cur: "US$",
  load: async () => {
    const machines = await fetchJson<Machine[]>("/api/milling/equipment");
    const generators = machines.filter((machine) => !machine.category || /GENERATOR|POWER/.test(machine.category));
    return { _generator: generators.map((machine) => ({ id: machine.id, label: `${machine.equipmentCode} · ${machine.name}` })), generator: generators[0] ? `${generators[0].equipmentCode} · ${generators[0].name}` : "None", from: "", to: nowLocal() };
  },
  sections: [
    {
      fields: [
        { id: "generator", t: "text", l: "Generator", o: (values) => labels(values, "generator", true) },
        { id: "from", t: "datetime", l: "Started", half: true, latest: "today" },
        { id: "to", t: "datetime", l: "Stopped", half: true, latest: "today" },
        { id: "meterStart", t: "text", l: "Hour meter at start", half: true, mono: true, right: true, inputMode: "decimal", opt: true },
        { id: "meterEnd", t: "text", l: "Hour meter at stop", half: true, mono: true, right: true, inputMode: "decimal", opt: true },
        { id: "litres", t: "text", l: "Diesel, litres", half: true, mono: true, right: true, inputMode: "decimal", needed: "Enter the litres used." },
        { id: "reason", t: "text", l: "Why", half: true, opt: true, p: "ZESA outage" },
      ],
    },
  ],
  note: "",
  primary: "Log it",
  done: "Generator run logged",
  submit: (values) => ({
    method: "POST",
    url: "/api/milling/generator",
    body: {
      equipmentId: idOf(values, "generator"),
      startedAt: iso(values.from),
      endedAt: iso(values.to),
      litres: numberOf(values.litres),
      meterStart: text(values.meterStart),
      meterEnd: text(values.meterEnd),
      reason: text(values.reason) || null,
    },
  }),
  invalidate: [["list"], ["milling"]],
  requires: [["ext:milling", "fuel.record"]],
};

export const MACHINE_SHEETS: Record<string, SheetKind> = {
  "mill-stop-new": stopNew,
  "mill-generator-run": generatorRun,
};
