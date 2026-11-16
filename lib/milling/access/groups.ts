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
  "order.manage",
  "delivery.manage",
  "delivery.own",
  "fuel.record",
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
  "ADMIN",
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
    description: "Approves plans, decides on exceptions and significant adjustments, and sees everything.",
    capabilities: ["plan.edit", "plan.approve", "exception.decide", "stock.adjust.approve", "shift.approve", "batch.approve"],
  },
  {
    code: "SUPERVISOR",
    name: "Production supervisor",
    description: "Allocates staff, opens and closes shifts, runs batches, approves closures and releases machines.",
    capabilities: ["plan.edit", "shift.manage", "shift.approve", "batch.run", "batch.approve", "machine.release", "stage.record", "fault.report"],
  },
  {
    code: "STORES",
    name: "Receiving and stores",
    description: "Receives maize, records weights, stores, moves and counts stock.",
    capabilities: ["intake.record", "stock.move", "stock.count"],
  },
  {
    code: "QUALITY",
    name: "Quality officer",
    description: "Inspects maize and product; releases, holds or rejects; follows up corrective actions.",
    capabilities: ["qc.record", "qc.decide"],
  },
  {
    code: "OPERATOR",
    name: "Production operator",
    description: "Records stage activity, quantities, faults and downtime.",
    capabilities: ["stage.record", "fault.report"],
  },
  {
    code: "DISPATCH",
    name: "Dispatch officer",
    description: "Takes orders, plans deliveries, checks loading and dispatches.",
    capabilities: ["order.manage", "delivery.manage"],
  },
  {
    code: "DRIVER",
    name: "Driver",
    description: "Records the outcome of their own deliveries, proof of delivery and fuel.",
    capabilities: ["delivery.own", "fuel.record"],
  },
  {
    code: "ADMIN",
    name: "System administrator",
    description: "Manages who is in which group and the mill's settings.",
    capabilities: ["settings.manage"],
  },
];

/** Roles that run the workspace: they may do everything at the mill without a group. */
const FULL_ACCESS_ROLES = new Set(["SUPERADMIN", "MANAGER"]);

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
  const held = new Set<MillCapability>();
  for (const group of MILL_GROUPS) {
    if (groups.includes(group.code)) group.capabilities.forEach((capability) => held.add(capability));
  }
  return {
    canView: groups.length > 0,
    groups,
    capabilities: MILL_CAPABILITIES.filter((capability) => held.has(capability)),
  };
}

export function can(access: Pick<MillAccess, "capabilities">, capability: MillCapability): boolean {
  return access.capabilities.includes(capability);
}
