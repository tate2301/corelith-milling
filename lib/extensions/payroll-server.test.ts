import { describe, expect, it } from "vitest";

import { readExtensionEarnings } from "./payroll-server";

const context = { companyId: "c", periodStart: new Date("2026-08-01"), periodEnd: new Date("2026-08-31"), employeeIds: ["e1", "e2"] };

describe("earnings from extensions", () => {
  it("keeps only the run's employees, real amounts and named lines", async () => {
    const { byEmployee, warnings } = await readExtensionEarnings(context, [
      {
        id: "milling",
        earnings: async () => [
          { employeeId: "e1", name: "Seller commission", amount: 12.345, currency: "usd" },
          { employeeId: "e1", name: "  ", amount: 5, currency: "USD" },
          { employeeId: "e2", name: "Nothing", amount: 0, currency: "USD" },
          { employeeId: "e9", name: "Not in this run", amount: 10, currency: "USD" },
        ],
      },
    ]);
    expect(warnings).toEqual([]);
    expect([...byEmployee.keys()]).toEqual(["e1"]);
    expect(byEmployee.get("e1")?.map((line) => [line.name, line.amount.toString(), line.currency, line.taxable, line.extensionId])).toEqual([["Seller commission", "12.35", "USD", true, "milling"]]);
  });

  it("reports an extension that fails and carries on with the rest", async () => {
    const { byEmployee, warnings } = await readExtensionEarnings(context, [
      { id: "down", earnings: async () => Promise.reject(new Error("no")) },
      { id: "up", earnings: async () => [{ employeeId: "e2", name: "Commission", amount: 3, currency: "USD", taxable: false }] },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("down");
    expect(byEmployee.get("e2")?.[0]?.taxable).toBe(false);
  });
});
