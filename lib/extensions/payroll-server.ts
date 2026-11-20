import { Prisma } from "@prisma/client";

import { registeredExtensionPayroll } from "@/extensions/payroll-server";

import type { ExtensionEarning, ExtensionPayrollContext, ExtensionPayrollServer } from "./server-types";

export type ExtensionPayrollLine = {
  name: string;
  amount: Prisma.Decimal;
  currency: string;
  taxable: boolean;
  extensionId: string;
};

/**
 * What the registered extensions add to each employee's pay for the period.
 * Only employees in the run are kept, amounts above nothing, and names given;
 * an extension that fails adds nothing and is reported, so a run is never
 * stopped by an extension.
 */
export async function readExtensionEarnings(
  context: ExtensionPayrollContext,
  servers: readonly ExtensionPayrollServer[] = registeredExtensionPayroll,
): Promise<{ byEmployee: Map<string, ExtensionPayrollLine[]>; warnings: string[] }> {
  const wanted = new Set(context.employeeIds);
  const byEmployee = new Map<string, ExtensionPayrollLine[]>();
  const warnings: string[] = [];
  for (const server of servers) {
    let earnings: ExtensionEarning[];
    try {
      earnings = await server.earnings(context);
    } catch (error) {
      console.error(`[extensions] ${server.id} payroll earnings failed:`, error);
      warnings.push(`Earnings from ${server.id} could not be read, so none were added. Assemble the run again once it is working.`);
      continue;
    }
    for (const earning of earnings) {
      if (!wanted.has(earning.employeeId)) continue;
      const amount = new Prisma.Decimal(Number.isFinite(earning.amount) ? earning.amount : 0).toDecimalPlaces(2);
      const name = earning.name?.trim();
      if (amount.lte(0) || !name) continue;
      const lines = byEmployee.get(earning.employeeId) ?? [];
      lines.push({ name, amount, currency: earning.currency.toUpperCase(), taxable: earning.taxable ?? true, extensionId: server.id });
      byEmployee.set(earning.employeeId, lines);
    }
  }
  return { byEmployee, warnings };
}
