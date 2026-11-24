import { z } from "zod";

import { fetchJson } from "@/lib/api-client";
import type { WorkOrderRecord } from "@/lib/maintenance/work-order-record";
import type { SheetKind, SheetValues } from "@/lib/workspace/sheet-kind";

/**
 * The Assets sheets: a machine or vehicle, a breakdown, a work order done, a
 * preventive plan, a service booked, a technician, a meter read. A choice is
 * a `text` field drawn as a select of labels; the ids travel beside it in the
 * values (`_<field>`) and are looked up again on submit.
 */

type Choice = { id: string; label: string };
type Lookups = {
  equipment: Array<{ id: string; equipmentCode: string; name: string; kind: "MACHINE" | "VEHICLE"; category: string; meterType: "NONE" | "HOURS" | "KM"; currentMeter: number | null; isActive: boolean; siteId: string; locationId: string; registrationNumber: string | null; make: string | null; model: string | null; serialNumber: string | null; commissionedAt: string | null }>;
  sites: Array<{ id: string; name: string; locations: Array<{ id: string; name: string }> }>;
  categories: string[];
  technicians: Array<{ employeeId: string; name: string; trade: string | null }>;
};

const NONE = "None";
const UNIT = { NONE: "", HOURS: "hours", KM: "km" } as const;
const METER_LABEL: Record<string, "NONE" | "HOURS" | "KM"> = { "No meter": "NONE", "Engine hours": "HOURS", Kilometres: "KM" };
const METER_WORD = { NONE: "No meter", HOURS: "Engine hours", KM: "Kilometres" } as const;
const PRIORITY: Record<string, string> = { Normal: "NORMAL", High: "HIGH", Urgent: "URGENT" };
const decimal = z.string().regex(/^\d+(\.\d+)?$/, "A number.");
const whole = z.string().regex(/^\d+$/, "A whole number.");
const invalidate = [["list"], ["reports"], ["maintenance"]];
const EQUIPMENT_EDIT: SheetKind["requires"] = [["maintenance.equipment", "update"]];
const ORDERS_EDIT: SheetKind["requires"] = [["maintenance.work-orders", "update"]];
const PLANS_EDIT: SheetKind["requires"] = [["maintenance.schedule", "update"]];

const labels = (values: SheetValues, field: string, optional = false) => {
  const options = ((values[`_${field}`] as Choice[] | undefined) ?? []).map((option) => option.label);
  return optional ? [NONE, ...options] : options;
};
const idOf = (values: SheetValues, field: string) => {
  const label = values[field];
  if (!label || label === NONE) return null;
  return ((values[`_${field}`] as Choice[] | undefined) ?? []).find((option) => option.label === label)?.id ?? null;
};
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const numberOrNull = (value: unknown) => (text(value) === "" ? null : Number(text(value)));
const lookups = () => fetchJson<Lookups>("/api/maintenance/lookups");
const equipmentChoices = (data: Lookups): Choice[] => data.equipment.filter((row) => row.isActive).map((row) => ({ id: row.id, label: `${row.name} (${row.equipmentCode})` }));
const technicianChoices = (data: Lookups): Choice[] => data.technicians.map((row) => ({ id: row.employeeId, label: row.trade ? `${row.name}, ${row.trade}` : row.name }));
const nowPicker = () => {
  const local = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};
const meterOfChosen = (values: SheetValues) => {
  const id = idOf(values, "equipment");
  return ((values._lookups as Lookups | undefined)?.equipment ?? []).find((row) => row.id === id);
};

/** Add machinery or a vehicle to the register, or change one. */
const equipment: SheetKind = {
  title: (ctx) => (ctx.id ? "Change the details" : "Add machinery or a vehicle"),
  sub: "What it is, where it is and what its meter counts. Plans and fuel count on the meter.",
  wide: true,
  cur: "US$",
  load: async (ctx) => {
    const data = await lookups();
    const row = data.equipment.find((entry) => entry.id === ctx.id);
    const _site: Choice[] = data.sites.map((site) => ({ id: site.id, label: site.name }));
    const site = data.sites.find((entry) => entry.id === row?.siteId) ?? data.sites[0];
    const _location: Choice[] = (site?.locations ?? []).map((location) => ({ id: location.id, label: location.name }));
    return {
      _lookups: data,
      _editing: Boolean(row),
      _site,
      _location,
      _category: data.categories.map((category) => ({ id: category, label: category.charAt(0) + category.slice(1).toLowerCase().replace(/_/g, " ") })),
      kind: row?.kind === "VEHICLE" ? "Vehicle" : "Machinery",
      name: row?.name ?? "",
      code: row?.equipmentCode ?? "",
      category: row ? row.category.charAt(0) + row.category.slice(1).toLowerCase().replace(/_/g, " ") : "",
      site: site?.name ?? "",
      location: (site?.locations ?? []).find((location) => location.id === row?.locationId)?.name ?? _location[0]?.label ?? "",
      make: row?.make ?? "",
      model: row?.model ?? "",
      serial: row?.serialNumber ?? "",
      plate: row?.registrationNumber ?? "",
      meter: METER_WORD[row?.meterType ?? "NONE"],
      commissioned: row?.commissionedAt ? row.commissionedAt.slice(0, 10) : null,
    };
  },
  sections: [
    {
      fields: [
        { id: "kind", t: "seg", l: "It is", o: ["Machinery", "Vehicle"] },
        { id: "name", t: "text", l: "Name", needed: "Name it.", p: "Hammer mill 2, UD truck" },
        { id: "code", t: "text", l: "Code", half: true, mono: true, upper: true, opt: true, h: "Left empty, one is made.", readWhen: (values) => Boolean(values._editing) },
        { id: "category", t: "text", l: "Kind", half: true, o: (values) => labels(values, "category"), needed: "Choose its kind." },
        {
          id: "site",
          t: "text",
          l: "Site",
          half: true,
          o: (values) => labels(values, "site"),
          follow: async (_value, values) => {
            const site = (values._lookups as Lookups).sites.find((entry) => entry.id === idOf(values, "site"));
            const _location = (site?.locations ?? []).map((location) => ({ id: location.id, label: location.name }));
            return { _location, location: _location[0]?.label ?? "" };
          },
        },
        { id: "location", t: "text", l: "Where", half: true, o: (values) => labels(values, "location"), needed: "Choose where it is." },
      ],
    },
    {
      title: "Identity",
      fields: [
        { id: "make", t: "text", l: "Make", half: true, opt: true },
        { id: "model", t: "text", l: "Model", half: true, opt: true },
        { id: "serial", t: "text", l: "Serial or chassis number", half: true, mono: true, opt: true },
        { id: "plate", t: "text", l: "Number plate", half: true, mono: true, upper: true, opt: true, show: (values) => values.kind === "Vehicle" },
        { id: "commissioned", t: "date", l: "In use since", half: true, opt: true, clearable: true },
        { id: "meter", t: "seg", l: "Its meter counts", o: ["No meter", "Engine hours", "Kilometres"], h: "Readings come in with fuel issues, services and by hand." },
      ],
    },
  ],
  note: "",
  primary: (values) => (values._editing ? "Save" : "Add it"),
  done: (_result, values) => (values._editing ? "Saved" : `${text(values.name)} added`),
  submit: (values, ctx) => {
    const body = {
      name: text(values.name),
      category: idOf(values, "category"),
      siteId: idOf(values, "site"),
      locationId: idOf(values, "location"),
      kind: values.kind === "Vehicle" ? "VEHICLE" : "MACHINE",
      make: text(values.make) || null,
      model: text(values.model) || null,
      serialNumber: text(values.serial) || null,
      registrationNumber: values.kind === "Vehicle" ? text(values.plate) || null : null,
      meterType: METER_LABEL[String(values.meter)] ?? "NONE",
      commissionedAt: (values.commissioned as string | null) || null,
    };
    return ctx.id ? { method: "PATCH", url: `/api/equipment/${ctx.id}`, body } : { method: "POST", url: "/api/equipment", body: { ...body, ...(text(values.code) ? { equipmentCode: text(values.code) } : {}) } };
  },
  invalidate,
  requires: EQUIPMENT_EDIT,
};

/** Log a breakdown: what stopped, since when, how urgent, and who is on it. */
const breakdown: SheetKind = {
  title: "Log a breakdown",
  sub: "It is down from when it stopped until the work order is done.",
  cur: "US$",
  load: async (ctx) => {
    const data = await lookups();
    const _equipment = equipmentChoices(data);
    const _technician = technicianChoices(data);
    const given = ctx.params.get("equipment");
    return { _equipment, _technician, equipment: _equipment.find((row) => row.id === given)?.label ?? "", started: nowPicker(), priority: "Normal", technician: NONE };
  },
  sections: [
    {
      fields: [
        { id: "equipment", t: "text", l: "Machine or vehicle", o: (values) => labels(values, "equipment"), needed: "Choose what broke down." },
        { id: "issue", t: "area", l: "What is wrong", rows: 3, needed: "Say what is wrong.", schema: z.string().trim().min(3, "Say what is wrong.").max(1000) },
        { id: "started", t: "datetime", l: "Stopped at", half: true, latest: "today", needed: "When did it stop?" },
        { id: "priority", t: "seg", l: "Priority", half: true, o: Object.keys(PRIORITY) },
        { id: "technician", t: "text", l: "Who is on it", o: (values) => labels(values, "technician", true), opt: true },
      ],
    },
  ],
  note: "",
  primary: "Log it",
  done: "Breakdown logged",
  open: (result) => ((result as { id?: string } | null)?.id ? `/maintenance/work-orders/${(result as { id: string }).id}` : null),
  submit: (values) => ({
    method: "POST",
    url: "/api/work-orders",
    body: { equipmentId: idOf(values, "equipment"), issue: text(values.issue), downtimeStart: String(values.started), priority: PRIORITY[String(values.priority)] ?? "NORMAL", status: "OPEN", ...(idOf(values, "technician") ? { technicianId: idOf(values, "technician") } : {}) },
  }),
  invalidate,
  requires: [["maintenance.breakdowns", "create"]],
};

/** The work is done: what was done, what it cost, and the meter it was done at. A service moves its plan on. */
const complete: SheetKind = {
  title: (_ctx, values) => `Complete ${String(values._what ?? "the work order")}`,
  sub: (_ctx, values) => (values._service ? "A service: its plan counts on from today and this meter." : "The machine is back at work from when it is finished."),
  cur: "US$",
  load: async (ctx) => {
    const order = await fetchJson<WorkOrderRecord>(`/api/work-orders/${ctx.id}`);
    return {
      _what: order.equipment.label,
      _service: order.kind === "PREVENTIVE",
      _meterType: order.meter.type,
      _meterNow: order.meter.current,
      done: order.workDone ?? "",
      parts: order.partsCost ? String(order.partsCost) : "",
      labour: order.laborCost ? String(order.laborCost) : "",
      meter: order.meter.current === null ? "" : String(order.meter.current),
      finished: nowPicker(),
    };
  },
  sections: [
    {
      fields: [
        { id: "done", t: "area", l: "What was done", rows: 3, needed: "Say what was done.", schema: z.string().trim().min(3, "Say what was done.").max(2000) },
        { id: "parts", t: "money", l: "Parts", half: true, opt: true },
        { id: "labour", t: "money", l: "Labour", half: true, opt: true },
        {
          id: "meter",
          t: "text",
          l: "Meter now",
          lw: (values) => `Meter now, ${UNIT[(values._meterType as keyof typeof UNIT) ?? "NONE"]}`,
          half: true,
          mono: true,
          right: true,
          inputMode: "decimal",
          opt: true,
          schema: decimal,
          show: (values) => values._meterType !== "NONE",
          h: (values) => (values._meterNow === null || values._meterNow === undefined ? "" : `Last read at ${Number(values._meterNow).toLocaleString("en-GB")}.`),
        },
        { id: "finished", t: "datetime", l: "Finished at", half: true, latest: "today" },
      ],
    },
  ],
  note: (values) => {
    const total = (numberOrNull(values.parts) ?? 0) + (numberOrNull(values.labour) ?? 0);
    return total > 0 ? `US$${total.toFixed(2)} goes to the books as maintenance.` : "";
  },
  primary: "Complete",
  done: "Work order completed",
  submit: (values, ctx) => ({
    method: "PATCH",
    url: `/api/work-orders/${ctx.id}`,
    body: {
      status: "COMPLETED",
      workDone: text(values.done),
      partsCost: numberOrNull(values.parts) ?? 0,
      laborCost: numberOrNull(values.labour) ?? 0,
      downtimeEnd: String(values.finished),
      ...(values._meterType !== "NONE" && text(values.meter) !== "" && Number(values.meter) !== Number(values._meterNow) ? { meterAtService: Number(values.meter) } : {}),
    },
  }),
  invalidate,
  requires: ORDERS_EDIT,
};

type Plan = { id: string; equipmentId: string; name: string; tasks: string | null; intervalDays: number | null; intervalMeter: number | null; leadDays: number; autoRaise: boolean; technicianId: string | null; nextDueAt: string | null };

/** A preventive plan: every so many days, on the meter, or both, whichever comes first. */
const plan: SheetKind = {
  title: (ctx) => (ctx.id ? "Change the plan" : "Add a preventive plan"),
  sub: "Its next due is worked out for you, from the last service and the meter's pace, and the earlier of time and meter counts.",
  wide: true,
  cur: "US$",
  load: async (ctx) => {
    const [data, row] = await Promise.all([lookups(), ctx.id ? fetchJson<Plan>(`/api/maintenance/plans/${ctx.id}`) : Promise.resolve(null)]);
    const _equipment = equipmentChoices(data);
    const _technician = technicianChoices(data);
    const given = row?.equipmentId ?? ctx.params.get("equipment");
    return {
      _lookups: data,
      _editing: Boolean(row),
      _equipment,
      _technician,
      equipment: _equipment.find((entry) => entry.id === given)?.label ?? "",
      name: row?.name ?? "",
      tasks: row?.tasks ?? "",
      days: row?.intervalDays ? String(row.intervalDays) : "",
      meterEvery: row?.intervalMeter ? String(row.intervalMeter) : "",
      lead: String(row?.leadDays ?? 7),
      auto: row?.autoRaise ?? true,
      technician: _technician.find((entry) => entry.id === row?.technicianId)?.label ?? NONE,
      lastDone: null,
      lastMeter: "",
    };
  },
  sections: [
    {
      fields: [
        { id: "equipment", t: "text", l: "Machine or vehicle", o: (values) => labels(values, "equipment"), needed: "Choose the machine or vehicle.", readWhen: (values) => Boolean(values._editing) },
        { id: "name", t: "text", l: "Service", needed: "Name the service.", p: "250-hour service, annual licence" },
        { id: "tasks", t: "area", l: "What is done", rows: 3, opt: true, h: "One task a line: the work order's checklist." },
      ],
    },
    {
      title: "How often",
      fields: [
        { id: "days", t: "text", l: "Every so many days", half: true, mono: true, right: true, inputMode: "numeric", opt: true, schema: whole, p: "90" },
        {
          id: "meterEvery",
          t: "text",
          l: "Every so much on the meter",
          lw: (values) => `Every so many ${UNIT[meterOfChosen(values)?.meterType ?? "NONE"] || "on the meter"}`,
          half: true,
          mono: true,
          right: true,
          inputMode: "decimal",
          opt: true,
          schema: decimal,
          show: (values) => (meterOfChosen(values)?.meterType ?? "NONE") !== "NONE",
          p: "250",
        },
        { id: "_either", t: "read", l: "", nolabel: true, v: "With both, whichever comes first.", show: (values) => text(values.days) !== "" && text(values.meterEvery) !== "" },
        { id: "lead", t: "text", l: "Raise it this many days ahead", half: true, mono: true, right: true, inputMode: "numeric", schema: whole },
        { id: "technician", t: "text", l: "Usually done by", half: true, o: (values) => labels(values, "technician", true), opt: true },
        { id: "auto", t: "toggle", l: "Raise the work order by itself when it comes due", opt: true, optQuiet: true },
      ],
    },
    {
      title: "Last done",
      show: (values) => !values._editing,
      fields: [
        { id: "lastDone", t: "date", l: "On", half: true, opt: true, latest: "today", clearable: true, h: "Left empty, it counts from today." },
        { id: "lastMeter", t: "text", l: "At the meter", half: true, mono: true, right: true, inputMode: "decimal", opt: true, schema: decimal, show: (values) => (meterOfChosen(values)?.meterType ?? "NONE") !== "NONE" },
      ],
    },
  ],
  note: "",
  primary: (values) => (values._editing ? "Save" : "Add the plan"),
  primaryDisabled: (values) => text(values.days) === "" && text(values.meterEvery) === "",
  done: (_result, values) => (values._editing ? "Plan saved" : "Plan added"),
  submit: (values, ctx) => {
    const body = {
      name: text(values.name),
      tasks: text(values.tasks) || null,
      intervalDays: numberOrNull(values.days),
      intervalMeter: (meterOfChosen(values)?.meterType ?? "NONE") === "NONE" ? null : numberOrNull(values.meterEvery),
      leadDays: Number(text(values.lead) || 7),
      autoRaise: values.auto === true,
      technicianId: idOf(values, "technician"),
    };
    return ctx.id
      ? { method: "PATCH", url: `/api/maintenance/plans/${ctx.id}`, body }
      : { method: "POST", url: "/api/maintenance/plans", body: { ...body, equipmentId: idOf(values, "equipment"), lastDoneAt: (values.lastDone as string | null) || null, lastDoneMeter: numberOrNull(values.lastMeter) } };
  },
  invalidate,
  requires: PLANS_EDIT,
};

/** Book a plan's service for a day: it becomes an open work order. */
const book: SheetKind = {
  title: (_ctx, values) => `Book ${String(values._name ?? "the service")}`,
  sub: "It becomes an open work order for the day chosen, with the plan's tasks and technician.",
  cur: "US$",
  load: async (ctx) => {
    const row = await fetchJson<Plan>(`/api/maintenance/plans/${ctx.id}`);
    const today = new Date().toISOString().slice(0, 10);
    const due = row.nextDueAt ? row.nextDueAt.slice(0, 10) : today;
    return { _name: row.name, day: due < today ? today : due };
  },
  sections: [{ fields: [{ id: "day", t: "date", l: "For", earliest: "today", needed: "Choose the day." }] }],
  note: "",
  primary: "Book it",
  done: "Service booked",
  open: (result) => ((result as { id?: string } | null)?.id ? `/maintenance/work-orders/${(result as { id: string }).id}` : null),
  submit: (values, ctx) => ({ method: "POST", url: `/api/maintenance/plans/${ctx.id}/book`, body: { scheduledFor: values.day } }),
  invalidate,
  requires: ORDERS_EDIT,
};

type Technicians = { technicians: Array<{ id: string; employeeId: string; name: string; trade: string | null; hourlyRate: number | null; isActive: boolean }>; employees: Array<{ id: string; name: string }> };

/** Make an employee a technician, or change one. */
const technician: SheetKind = {
  title: (ctx) => (ctx.id ? "Change the technician" : "Add a technician"),
  sub: "Their trade, and what an hour of their time costs a work order.",
  cur: "US$",
  load: async (ctx) => {
    const data = await fetchJson<Technicians>("/api/maintenance/technicians");
    const row = data.technicians.find((entry) => entry.id === ctx.id);
    const taken = new Set(data.technicians.filter((entry) => entry.isActive).map((entry) => entry.employeeId));
    const _employee: Choice[] = data.employees.filter((entry) => !taken.has(entry.id)).map((entry) => ({ id: entry.id, label: entry.name }));
    return { _editing: Boolean(row), _name: row?.name ?? "", _employee, employee: "", trade: row?.trade ?? "", rate: row?.hourlyRate ? String(row.hourlyRate) : "", active: row?.isActive ?? true };
  },
  sections: [
    {
      fields: [
        { id: "employee", t: "text", l: "Employee", o: (values) => labels(values, "employee"), needed: "Choose the employee.", show: (values) => !values._editing },
        { id: "_who", t: "read", l: "Technician", v: "", derive: (values) => String(values._name ?? ""), show: (values) => Boolean(values._editing) },
        { id: "trade", t: "text", l: "Trade", half: true, opt: true, p: "Diesel mechanic, electrician" },
        { id: "rate", t: "money", l: "An hour", half: true, opt: true },
        { id: "active", t: "toggle", l: "Still works here", opt: true, optQuiet: true, show: (values) => Boolean(values._editing) },
      ],
    },
  ],
  note: "",
  primary: (values) => (values._editing ? "Save" : "Add the technician"),
  done: "Saved",
  submit: (values, ctx) =>
    ctx.id
      ? { method: "PATCH", url: `/api/maintenance/technicians/${ctx.id}`, body: { trade: text(values.trade) || null, hourlyRate: numberOrNull(values.rate), isActive: values.active === true } }
      : { method: "POST", url: "/api/maintenance/technicians", body: { employeeId: idOf(values, "employee"), trade: text(values.trade) || null, hourlyRate: numberOrNull(values.rate) } },
  invalidate,
  requires: ORDERS_EDIT,
};

/** Read a machine's meter by hand. Meters only go up. */
const meter: SheetKind = {
  title: (_ctx, values) => `Read the meter on ${String(values._name ?? "it")}`,
  sub: "Meters only go up. Plans counted on the meter move with the reading.",
  cur: "US$",
  load: async (ctx) => {
    const data = await lookups();
    const row = data.equipment.find((entry) => entry.id === ctx.id);
    return { _name: row?.name ?? "", _unit: UNIT[row?.meterType ?? "NONE"], _now: row?.currentMeter ?? null, reading: "", at: nowPicker() };
  },
  sections: [
    {
      fields: [
        {
          id: "reading",
          t: "text",
          l: "Reading",
          lw: (values) => `Reading, ${String(values._unit ?? "")}`,
          half: true,
          mono: true,
          right: true,
          inputMode: "decimal",
          needed: "Type the reading.",
          schema: decimal,
          h: (values) => (values._now === null || values._now === undefined ? "No reading yet." : `Last read at ${Number(values._now).toLocaleString("en-GB")}.`),
        },
        { id: "at", t: "datetime", l: "Read at", half: true, latest: "today" },
      ],
    },
  ],
  note: "",
  primary: "Save the reading",
  done: "Reading saved",
  submit: (values, ctx) => ({ method: "POST", url: `/api/equipment/${ctx.id}/meter-readings`, body: { reading: Number(values.reading), readAt: new Date(String(values.at)).toISOString(), source: "MANUAL" } }),
  invalidate,
  requires: EQUIPMENT_EDIT,
};

export const MAINTENANCE_SHEETS: Record<string, SheetKind> = {
  "maint-equipment": equipment,
  "maint-breakdown": breakdown,
  "maint-complete": complete,
  "maint-plan": plan,
  "maint-book": book,
  "maint-technician": technician,
  "maint-meter": meter,
};
