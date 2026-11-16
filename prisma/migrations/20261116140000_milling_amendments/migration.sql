-- Corrections that keep the original: docs/milling/DECISIONS.md, D8.
-- CreateTable
CREATE TABLE "MillingAmendment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT NOT NULL,
    "amendedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MillingAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MillingAmendment_companyId_entityType_entityId_createdAt_idx" ON "MillingAmendment"("companyId", "entityType", "entityId", "createdAt");

