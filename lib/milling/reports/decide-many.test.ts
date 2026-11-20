import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { millAccessFor } from "../access/groups";
import { createOrder, submitOrder } from "../production/orders";
import { recordOpeningStock } from "../stock/counts";
import { makeMill, removeMill } from "../testing/fixture";
import { decideMany } from "./decide-many";
import { waitingFor } from "./home";

let mill: Awaited<ReturnType<typeof makeMill>>;
const who = () => ({ companyId: mill.companyId, userId: mill.userId });
const manager = millAccessFor("CLERK", ["MANAGEMENT"]);

beforeAll(async () => {
  mill = await makeMill("decide-many");
  await recordOpeningStock(prisma, { ...who(), productId: mill.product("MAIZE"), stockLocationId: mill.location("MZ-STORE"), quantity: 50000, lotCode: "M-OPEN" });
  await recordOpeningStock(prisma, { ...who(), productId: mill.product("BAG-10"), stockLocationId: mill.location("PKG"), quantity: 1000 });
});
afterAll(async () => {
  await removeMill(mill.companyId);
});

async function submittedPlan(bags: number) {
  const order = await createOrder(prisma, { ...who(), productionDate: "2026-11-21", shiftKind: "DAY", lines: [{ productId: mill.product("MEAL-10"), bags }] });
  await submitOrder(prisma, { ...who(), orderId: order.id });
  return order;
}

describe("deciding several at once from the Overview", () => {
  it("offers plans to choose, approves each through its own checks, and reports each", async () => {
    const small = await submittedPlan(100);
    const huge = await submittedPlan(100000);
    const rows = await waitingFor(prisma, mill.companyId, manager);
    expect(rows.filter((row) => row.bulk?.kind === "plan").map((row) => row.code).sort()).toEqual([small.code, huge.code].sort());

    const results = await decideMany(prisma, { ...who(), access: manager, action: "approve", items: [{ kind: "plan", id: small.id }, { kind: "plan", id: huge.id }] });
    expect(results.find((row) => row.id === small.id)?.message).toBe(`${small.code} approved`);
    // Short of maize: refused by approveOrder's own check; the other still went through.
    expect(results.find((row) => row.id === huge.id)).toMatchObject({ ok: false });
    expect(results.find((row) => row.id === huge.id)?.message).toMatch(/Short of/);
    expect((await prisma.millingProductionOrder.findUniqueOrThrow({ where: { id: small.id } })).status).toBe("APPROVED");
  });

  it("sends plans back only with a reason, and refuses what the person may not decide", async () => {
    const plan = await submittedPlan(50);
    expect((await decideMany(prisma, { ...who(), access: manager, action: "send-back", items: [{ kind: "plan", id: plan.id }] }))[0]).toMatchObject({ ok: false, message: "Say why it is sent back." });
    const sent = await decideMany(prisma, { ...who(), access: manager, action: "send-back", reason: "Wrong date", items: [{ kind: "plan", id: plan.id }] });
    expect(sent[0]).toMatchObject({ ok: true });
    expect((await prisma.millingProductionOrder.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("DRAFT");

    const driver = millAccessFor("CLERK", ["DRIVER"]);
    expect((await decideMany(prisma, { ...who(), access: driver, action: "approve", items: [{ kind: "plan", id: plan.id }] }))[0]).toMatchObject({ ok: false });
    expect((await decideMany(prisma, { ...who(), access: manager, action: "send-back", reason: "x y z", items: [{ kind: "shift", id: plan.id }] }))[0]?.message).toMatch(/not sent back/);
  });
});
