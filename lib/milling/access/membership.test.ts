import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { listMillMembers, MillMembershipError, setMillGroups } from "./membership";

const run = Date.now().toString(36);
let companyId = "";
let otherCompanyId = "";
let ownerId = "";
let clerkId = "";
let strangerId = "";

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: `Mill ${run}`, slug: `mill-${run}`, tenantStatus: "ACTIVE" } })).id;
  otherCompanyId = (await prisma.company.create({ data: { name: `Other ${run}`, slug: `other-${run}`, tenantStatus: "ACTIVE" } })).id;
  ownerId = (await prisma.user.create({ data: { name: "Owner", email: `owner-${run}@x.test`, role: "SUPERADMIN", companyId } })).id;
  clerkId = (await prisma.user.create({ data: { name: "Clerk", email: `clerk-${run}@x.test`, role: "CLERK", companyId } })).id;
  strangerId = (await prisma.user.create({ data: { name: "Stranger", email: `stranger-${run}@x.test`, role: "CLERK", companyId: otherCompanyId } })).id;
});

afterAll(async () => {
  const companies = [companyId, otherCompanyId];
  await prisma.millingGroupMember.deleteMany({ where: { companyId: { in: companies } } });
  await prisma.platformAuditEvent.deleteMany({ where: { companyId: { in: companies } } });
  await prisma.user.deleteMany({ where: { companyId: { in: companies } } });
  await prisma.company.deleteMany({ where: { id: { in: companies } } });
});

describe("mill group membership", () => {
  it("puts a person in exactly the groups given, and records the change", async () => {
    await setMillGroups(prisma, { companyId, actorId: ownerId, userId: clerkId, groups: ["STORES", "QUALITY"] });
    await setMillGroups(prisma, { companyId, actorId: ownerId, userId: clerkId, groups: ["QUALITY", "DRIVER"] });

    const clerk = (await listMillMembers(prisma, companyId)).find((member) => member.userId === clerkId);
    expect(clerk?.groups).toEqual(["QUALITY", "DRIVER"]);

    const events = await prisma.platformAuditEvent.findMany({
      where: { companyId, eventType: "milling.groups.changed", entityId: clerkId },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((event) => JSON.parse(event.payloadJson ?? "{}"))).toEqual([
      { added: ["STORES", "QUALITY"], removed: [] },
      { added: ["DRIVER"], removed: ["STORES"] },
    ]);
  });

  it("writes nothing when nothing changes", async () => {
    const before = await prisma.platformAuditEvent.count({ where: { companyId } });
    await setMillGroups(prisma, { companyId, actorId: ownerId, userId: clerkId, groups: ["DRIVER", "QUALITY"] });
    expect(await prisma.platformAuditEvent.count({ where: { companyId } })).toBe(before);
  });

  it("refuses an unknown group and a person from another workspace", async () => {
    await expect(
      setMillGroups(prisma, { companyId, actorId: ownerId, userId: clerkId, groups: ["BOSS"] }),
    ).rejects.toBeInstanceOf(MillMembershipError);
    await expect(
      setMillGroups(prisma, { companyId, actorId: ownerId, userId: strangerId, groups: ["STORES"] }),
    ).rejects.toThrow("not in this workspace");
  });
});

describe("mill access follows the groups", () => {
  it("opens the mill to a clerk in a group, and closes it when they leave every group", async () => {
    const { getEffectiveFeaturesForUser } = await import("@/lib/platform/user-entitlements");
    const { provisionTenant } = await import("@/lib/platform/provision");
    const slug = `access-${run}`;
    const tenant = await provisionTenant({ name: `Access ${run}`, slug, templateCode: "TEMPLATE_MILLING", tierCode: "ENTERPRISE", adminEmail: `boss-${run}@x.test`, adminName: "Boss", subscriptionStatus: "ACTIVE", actor: "test", reason: "test" });
    const companyId = tenant.company.id;
    const clerk = await prisma.user.create({ data: { name: "Clerk", email: `mill-clerk-${run}@x.test`, role: "CLERK", companyId } });
    const features = () => getEffectiveFeaturesForUser({ companyId, userId: clerk.id, role: "CLERK" });
    try {
      expect(await features()).not.toContain("milling.home");
      await setMillGroups(prisma, { companyId, actorId: tenant.admin.id, userId: clerk.id, groups: ["STORES"] });
      expect(await features()).toContain("milling.home");
      await setMillGroups(prisma, { companyId, actorId: tenant.admin.id, userId: clerk.id, groups: [] });
      expect(await features()).not.toContain("milling.home");
    } finally {
      await prisma.userFeatureFlag.deleteMany({ where: { userId: clerk.id } });
      await prisma.millingGroupMember.deleteMany({ where: { companyId } });
    }
  });
});
