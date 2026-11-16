-- L2: lots by location, reservations, exceptions, intake, QC and counts (DECISIONS.md, D7).
-- CreateTable
CREATE TABLE "MillingLot" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'HOLD',
    "originType" TEXT NOT NULL,
    "originId" TEXT,
    "producedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attributes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MillingLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingLotBalance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "stockLocationId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MillingLotBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingLotMovement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "stockMovementId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "isEstimated" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MillingLotMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingReservation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "stockLocationId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "MillingReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingException" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "allowedDecisions" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "decision" TEXT,
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "raisedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MillingException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingIntake" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "deliveryRef" TEXT,
    "vehicleReg" TEXT,
    "driverName" TEXT,
    "variety" TEXT,
    "weighMethod" TEXT NOT NULL,
    "bags" INTEGER,
    "bagKg" DECIMAL(8,2),
    "grossKg" DECIMAL(12,2),
    "tareKg" DECIMAL(12,2),
    "netKg" DECIMAL(12,2) NOT NULL,
    "ticketNumber" TEXT,
    "ticketFileUrl" TEXT,
    "weightStatus" TEXT NOT NULL DEFAULT 'PROVISIONAL',
    "status" TEXT NOT NULL DEFAULT 'AWAITING_QC',
    "binLocationId" TEXT,
    "lotId" TEXT,
    "notes" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MillingIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingQcInspection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "point" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "inspectedById" TEXT NOT NULL,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MillingQcInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingQcResult" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "specId" TEXT NOT NULL,
    "specVersion" INTEGER NOT NULL,
    "specCode" TEXT NOT NULL,
    "specName" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "value" DECIMAL(12,3),
    "passed" BOOLEAN,
    "note" TEXT,

    CONSTRAINT "MillingQcResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingStockCount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "stockLocationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "countedById" TEXT NOT NULL,
    "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "MillingStockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingStockCountLine" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "expected" DECIMAL(14,3) NOT NULL,
    "counted" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "MillingStockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MillingLot_companyId_productId_status_idx" ON "MillingLot"("companyId", "productId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MillingLot_companyId_code_key" ON "MillingLot"("companyId", "code");

-- CreateIndex
CREATE INDEX "MillingLotBalance_companyId_stockLocationId_idx" ON "MillingLotBalance"("companyId", "stockLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "MillingLotBalance_lotId_stockLocationId_key" ON "MillingLotBalance"("lotId", "stockLocationId");

-- CreateIndex
CREATE INDEX "MillingLotMovement_companyId_createdAt_idx" ON "MillingLotMovement"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "MillingLotMovement_lotId_createdAt_idx" ON "MillingLotMovement"("lotId", "createdAt");

-- CreateIndex
CREATE INDEX "MillingLotMovement_companyId_sourceType_sourceId_idx" ON "MillingLotMovement"("companyId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "MillingReservation_companyId_status_idx" ON "MillingReservation"("companyId", "status");

-- CreateIndex
CREATE INDEX "MillingReservation_lotId_status_idx" ON "MillingReservation"("lotId", "status");

-- CreateIndex
CREATE INDEX "MillingReservation_companyId_sourceType_sourceId_idx" ON "MillingReservation"("companyId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "MillingException_companyId_status_createdAt_idx" ON "MillingException"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MillingException_companyId_targetType_targetId_idx" ON "MillingException"("companyId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "MillingException_companyId_code_key" ON "MillingException"("companyId", "code");

-- CreateIndex
CREATE INDEX "MillingIntake_companyId_status_receivedAt_idx" ON "MillingIntake"("companyId", "status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MillingIntake_companyId_code_key" ON "MillingIntake"("companyId", "code");

-- CreateIndex
CREATE INDEX "MillingQcInspection_companyId_targetType_targetId_idx" ON "MillingQcInspection"("companyId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "MillingQcInspection_companyId_point_inspectedAt_idx" ON "MillingQcInspection"("companyId", "point", "inspectedAt");

-- CreateIndex
CREATE INDEX "MillingQcResult_inspectionId_idx" ON "MillingQcResult"("inspectionId");

-- CreateIndex
CREATE INDEX "MillingStockCount_companyId_countedAt_idx" ON "MillingStockCount"("companyId", "countedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MillingStockCount_companyId_code_key" ON "MillingStockCount"("companyId", "code");

-- CreateIndex
CREATE INDEX "MillingStockCountLine_countId_idx" ON "MillingStockCountLine"("countId");

-- AddForeignKey
ALTER TABLE "MillingLotBalance" ADD CONSTRAINT "MillingLotBalance_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "MillingLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MillingLotMovement" ADD CONSTRAINT "MillingLotMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "MillingLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MillingQcResult" ADD CONSTRAINT "MillingQcResult_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "MillingQcInspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MillingStockCountLine" ADD CONSTRAINT "MillingStockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "MillingStockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

