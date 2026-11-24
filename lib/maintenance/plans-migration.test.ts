/**
 * Migration witness for `20261124120000_maintenance_plans_technicians`.
 *
 * Plans and technicians go with their workspace and their machine or
 * employee; a work order outlives the plan that raised it; a plan says how
 * often; and both tables are under row security like WorkOrder.
 */
import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

const onDelete = async (table: string, column: string) =>
  (
    await prisma.$queryRaw<Array<{ rule: string }>>`
      SELECT rc.delete_rule AS rule FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = rc.constraint_name
      WHERE kcu.table_name = ${table} AND kcu.column_name = ${column}`
  )[0]?.rule ?? null;

describe("maintenance plans and technicians, as stored", () => {
  it("cascades with the workspace and the machine, and keeps a work order when its plan goes", async () => {
    expect(await onDelete("MaintenancePlan", "companyId")).toBe("CASCADE");
    expect(await onDelete("MaintenancePlan", "equipmentId")).toBe("CASCADE");
    expect(await onDelete("MaintenancePlan", "technicianId")).toBe("SET NULL");
    expect(await onDelete("MaintenanceTechnician", "employeeId")).toBe("CASCADE");
    expect(await onDelete("WorkOrder", "planId")).toBe("SET NULL");
  });

  it("names a work order a breakdown or a service, and a machine a machine or a vehicle", async () => {
    const [kinds] = await prisma.$queryRaw<Array<{ order: string; equipment: string }>>`
      SELECT enum_range(NULL::"WorkOrderKind")::text AS order, enum_range(NULL::"EquipmentKind")::text AS equipment`;
    expect(kinds).toEqual({ order: "{BREAKDOWN,PREVENTIVE}", equipment: "{MACHINE,VEHICLE}" });
  });

  it("refuses a plan that says no interval", async () => {
    const [check] = await prisma.$queryRaw<Array<{ def: string }>>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'MaintenancePlan_interval_check'`;
    expect(check?.def).toContain("intervalDays");
    expect(check?.def).toContain("intervalMeter");
  });

  it("is under row security like WorkOrder", async () => {
    const tables = await prisma.$queryRaw<Array<{ relname: string; relrowsecurity: boolean }>>`
      SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('MaintenancePlan', 'MaintenanceTechnician') ORDER BY relname`;
    expect(tables).toEqual([
      { relname: "MaintenancePlan", relrowsecurity: true },
      { relname: "MaintenanceTechnician", relrowsecurity: true },
    ]);
    const policies = await prisma.$queryRaw<Array<{ policyname: string }>>`SELECT policyname FROM pg_policies WHERE tablename = 'MaintenancePlan' ORDER BY policyname`;
    expect(policies.map((row) => row.policyname)).toEqual(["app_all", "explore_workspace", "vane_workspace"]);
  });
});
