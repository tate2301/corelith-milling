/**
 * Who may do what at the mill.
 *
 * Core gives each person one role. The mill's spec asks for groups one person
 * can hold several of: a supervisor who also releases stock, a stores officer
 * who also drives. These eight groups sit on top of the role, for the mill's
 * own screens and APIs only; core's modules (Stores, Books, People) keep their
 * own rules.
 *
 * The groups and what each may do are fixed here (DECISIONS.md, D3). An
 * administrator decides who is in which group.
 *
 * Plain data: imported by pages and route handlers alike.
 */

export const MILL_CAPABILITIES = [
  "plan.edit",
  "plan.approve",
  "exception.decide",
  "stock.adjust.approve",
  "shift.manage",
  "shift.approve",
  "batch.run",
  "batch.approve",
  "machine.release",
  "intake.record",
  "stock.move",
  "stock.count",
  "qc.record",
  "qc.decide",
  "stage.record",
  "fault.report",
  "order.log",
  "order.assign",
  "order.work",
  "order.close",
  "voucher.issue",
  "money.view",
  "audit.read",
  "cost.set",
  "production.run",
  "delivery.manage",
  "delivery.own",
  "fuel.record",
  "seller.manage",
  "visit.record",
  "collection.record",
  "sale.record",
  "settings.manage",
] as const;

export type MillCapability = (typeof MILL_CAPABILITIES)[number];

export const MILL_GROUP_CODES = [
  "MANAGEMENT",
  "SUPERVISOR",
  "STORES",
  "QUALITY",
  "OPERATOR",
  "DISPATCH",
  "DRIVER",
  "SALES_REP",
  "DIRECTOR",
  "ADMIN",
  "ACCOUNTANT",
  "MARKETING",
  "SECURITY",
  "AUDITOR",
] as const;

export type MillGroupCode = (typeof MILL_GROUP_CODES)[number];

export interface MillGroup {
  code: MillGroupCode;
  name: string;
  description: string;
  capabilities: readonly MillCapability[];
}

export const MILL_GROUPS: readonly MillGroup[] = [
  {
    code: "MANAGEMENT",
    name: "Management",
    description: "The manager: plans trips, approves plans, decides on exceptions and significant adjustments. Changes no price or money record.",
    capabilities: ["plan.edit", "plan.approve", "exception.decide", "stock.adjust.approve", "shift.approve", "batch.approve", "delivery.manage", "sale.record"],
  },
  {
    code: "SUPERVISOR",
    name: "Production supervisor",
    description: "Allocates staff, opens and closes shifts, runs batches, approves closures and releases machines.",
    capabilities: ["plan.edit", "shift.manage", "shift.approve", "batch.run", "batch.approve", "machine.release", "stage.record", "fault.report", "fuel.record", "production.run"],
  },
  {
    code: "STORES",
    name: "Receiving and stores",
    description: "Receives maize, records weights, stores, moves and counts stock, and sells bags at the till.",
    capabilities: ["intake.record", "stock.move", "stock.count", "seller.manage", "sale.record"],
  },
  {
    code: "QUALITY",
    name: "Quality officer",
    description: "Inspects maize and product; releases, holds or rejects; follows up corrective actions.",
    capabilities: ["qc.record", "qc.decide"],
  },
  {
    code: "OPERATOR",
    name: "Production",
    description: "Records production runs (bags, batch number, date produced and the maize actually used), stage activity, faults and downtime. Sees no costs or accounts.",
    capabilities: ["production.run", "stage.record", "fault.report"],
  },
  {
    code: "DISPATCH",
    name: "Dispatch officer",
    description: "Plans deliveries, checks loading and dispatches.",
    capabilities: ["delivery.manage", "seller.manage"],
  },
  {
    code: "DRIVER",
    name: "Driver",
    description: "Records the outcome of their own deliveries, proof of delivery and fuel.",
    capabilities: ["delivery.own", "fuel.record"],
  },
  {
    code: "SALES_REP",
    name: "Sales rep",
    description: "Works the orders assigned to them and their own trips: moves an order to Ongoing and Complete, sells bags, adds customers, issues one voucher a customer, visits shops and chases what they owe. Sees no cost, margin or accounts.",
    capabilities: ["order.work", "voucher.issue", "visit.record", "collection.record", "sale.record"],
  },
  {
    code: "DIRECTOR",
    name: "Director",
    description: "Reads the whole mill and its reports; decides nothing at the mill.",
    capabilities: [],
  },
  {
    code: "ADMIN",
    name: "System administrator",
    description: "Manages who is in which group and the mill's settings.",
    capabilities: ["settings.manage"],
  },
  {
    code: "ACCOUNTANT",
    name: "Accountant",
    description: "Every money page: assigns orders to reps and to trips, closes deliveries once the money is in, sets cost treatments, raises credit notes and settles returns and missing bags. Cannot void posted records.",
    capabilities: ["order.assign", "order.work", "order.close", "money.view", "audit.read", "cost.set", "collection.record"],
  },
  {
    code: "MARKETING",
    name: "Marketing agent",
    description: "Logs the orders it wins and their customers, and sees how its own orders are going. Changes no order after Pending; sees no accounts.",
    capabilities: ["order.log"],
  },
  {
    code: "SECURITY",
    name: "Security",
    description: "Approves trucks out and back in at the gate. Changes no trip, stock or reading.",
    capabilities: ["delivery.own"],
  },
  {
    code: "AUDITOR",
    name: "Outside accountant",
    description: "The owner's rights over the books: reads every money page and the audit log, and may void under Books' rules.",
    capabilities: ["order.close", "money.view", "audit.read", "cost.set"],
  },
];

/** The owner: everything at the mill without a group. */
const FULL_ACCESS_ROLES = new Set(["SUPERADMIN"]);
/**
 * Only accounting sees and changes money records (Grandmeal spec,
 * Permissions). Core's workspace manager runs the rest of the mill without a
 * group, but holds these only through the Accountant or Outside accountant
 * group.
 */
export const MONEY_CAPABILITIES: readonly MillCapability[] = ["order.assign", "order.close", "money.view", "audit.read", "cost.set"];
const MANAGER_ROLES = new Set(["MANAGER"]);

export function isMillGroupCode(value: string): value is MillGroupCode {
  return (MILL_GROUP_CODES as readonly string[]).includes(value);
}

export interface MillAccess {
  /** Whether the person sees the mill at all: full-access role or at least one group. */
  canView: boolean;
  groups: MillGroupCode[];
  capabilities: MillCapability[];
}

/** A person's mill access: everything for the workspace's owners and managers, else the union of their groups. */
export function millAccessFor(role: string, groupCodes: readonly string[]): MillAccess {
  const groups = MILL_GROUP_CODES.filter((code) => groupCodes.includes(code));
  if (FULL_ACCESS_ROLES.has(role)) {
    return { canView: true, groups, capabilities: [...MILL_CAPABILITIES] };
  }
  const held = new Set<MillCapability>(MANAGER_ROLES.has(role) ? MILL_CAPABILITIES.filter((capability) => !MONEY_CAPABILITIES.includes(capability)) : []);
  for (const group of MILL_GROUPS) {
    if (groups.includes(group.code)) group.capabilities.forEach((capability) => held.add(capability));
  }
  return {
    canView: groups.length > 0 || MANAGER_ROLES.has(role),
    groups,
    capabilities: MILL_CAPABILITIES.filter((capability) => held.has(capability)),
  };
}

export function can(access: Pick<MillAccess, "capabilities">, capability: MillCapability): boolean {
  return access.capabilities.includes(capability);
}
