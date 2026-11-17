-- The mill's permission groups: who is in which (lib/milling/access/groups.ts).
-- No foreign keys to core tables: see docs/milling/DECISIONS.md, D2.
-- CreateTable
CREATE TABLE "MillingGroupMember" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "MillingGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MillingGroupMember_companyId_groupCode_idx" ON "MillingGroupMember"("companyId", "groupCode");

-- CreateIndex
CREATE UNIQUE INDEX "MillingGroupMember_userId_groupCode_key" ON "MillingGroupMember"("userId", "groupCode");

