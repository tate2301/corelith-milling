import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { AmendmentError, diffFields, recordAmendment } from "./amend";
import { recordHistory } from "./history";

const run = Date.now().toString(36);
let companyId = "";
let actorId = "";
const entity = { entityType: "MillingTest", entityId: "record-1" };

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: `Amend ${run}`, slug: `amend-${run}`, tenantStatus: "ACTIVE" } })).id;
  actorId = (await prisma.user.create({ data: { name: "Rudo", email: `rudo-${run}@x.test`, role: "MANAGER", companyId } })).id;
});

afterAll(async () => {
  await prisma.millingAmendment.deleteMany({ where: { companyId } });
  await prisma.platformAuditEvent.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
});

describe("corrections that keep the original", () => {
  it("finds only the fields that really change", () => {
    expect(diffFields({ netKg: 1000, note: "a", at: new Date("2026-11-16") }, { netKg: "1000", note: "b", at: new Date("2026-11-16"), other: undefined })).toEqual({
      note: { from: "a", to: "b" },
    });
  });

  it("keeps each old and new value with the reason, and shows them in History", async () => {
    await prisma.$transaction((tx) =>
      recordAmendment(tx, {
        companyId,
        actorId,
        ...entity,
        changes: diffFields({ netKg: 30000, supplierRef: "T-1" }, { netKg: 29850, supplierRef: "T-1" }),
        reason: "Weighbridge ticket arrived",
      }),
    );
    const history = await recordHistory(prisma, { companyId, ...entity });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ kind: "amendment", what: "netKg", from: 30000, to: 29850, who: "Rudo", reason: "Weighbridge ticket arrived" });
    expect(await prisma.platformAuditEvent.count({ where: { companyId, eventType: "milling.record.amended" } })).toBe(1);
  });

  it("refuses a correction with no reason or nothing changed", async () => {
    await expect(
      prisma.$transaction((tx) => recordAmendment(tx, { companyId, actorId, ...entity, changes: { a: { from: 1, to: 2 } }, reason: " " })),
    ).rejects.toBeInstanceOf(AmendmentError);
    await expect(
      prisma.$transaction((tx) => recordAmendment(tx, { companyId, actorId, ...entity, changes: {}, reason: "because" })),
    ).rejects.toThrow("Nothing has changed");
  });
});
