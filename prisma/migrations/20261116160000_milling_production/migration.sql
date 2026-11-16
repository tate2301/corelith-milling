-- L3: production orders, shifts, batches and stages, packing, machine state, downtime and generator runs.
-- AlterTable
ALTER TABLE "MillingSettings" ADD COLUMN     "plannedLossPct" DECIMAL(5,2) NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "MillingProductionOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "productionDate" DATE NOT NULL,
    "shiftKind" TEXT NOT NULL,
    "supervisorId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "maizeNeededKg" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "approvedShort" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MillingProductionOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingProductionOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "bags" INTEGER,
    "kg" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "MillingProductionOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingShift" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "supervisorId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "materialInProcessKg" DECIMAL(14,3),
    "materialEstimated" BOOLEAN NOT NULL DEFAULT true,
    "handoverNotes" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MillingShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingShiftAssignment" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "dutyId" TEXT,
    "attendance" TEXT NOT NULL DEFAULT 'PRESENT',
    "clockIn" TIMESTAMP(3),
    "clockOut" TIMESTAMP(3),
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeHours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "absenceReason" TEXT,

    CONSTRAINT "MillingShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "orderId" TEXT,
    "shiftId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "maizeIssuedKg" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "maizeCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "waterAddedKg" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "inProcessChangeKg" DECIMAL(14,3),
    "outputKg" DECIMAL(14,3),
    "separatedKg" DECIMAL(14,3),
    "unaccountedKg" DECIMAL(14,3),
    "variancePct" DECIMAL(7,3),
    "yields" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MillingBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingBatchSourceLot" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "stockLocationId" TEXT NOT NULL,
    "quantityKg" DECIMAL(14,3) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MillingBatchSourceLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingStageRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "stageCode" TEXT NOT NULL,
    "shiftId" TEXT,
    "equipmentCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "operatorId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "inputKg" DECIMAL(14,3),
    "inputEstimated" BOOLEAN NOT NULL DEFAULT true,
    "removedKg" DECIMAL(14,3),
    "removedEstimated" BOOLEAN NOT NULL DEFAULT true,
    "waterLitres" DECIMAL(10,2),
    "moistureBeforePct" DECIMAL(5,2),
    "moistureAfterPct" DECIMAL(5,2),
    "observations" TEXT,
    "abnormal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MillingStageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingBatchOutput" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "stockLocationId" TEXT NOT NULL,
    "quantityKg" DECIMAL(14,3) NOT NULL,
    "isEstimated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MillingBatchOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingPackRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "bulkLotId" TEXT NOT NULL,
    "bulkLocationId" TEXT NOT NULL,
    "outputLocationId" TEXT NOT NULL,
    "outputLotId" TEXT NOT NULL,
    "bagsPacked" INTEGER NOT NULL,
    "damagedBags" INTEGER NOT NULL DEFAULT 0,
    "bulkUsedKg" DECIMAL(14,3) NOT NULL,
    "varianceKg" DECIMAL(14,3) NOT NULL,
    "checkWeights" DECIMAL(8,3)[],
    "shiftId" TEXT,
    "packedById" TEXT NOT NULL,
    "packedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MillingPackRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingEquipmentState" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "availability" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MillingEquipmentState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingDowntime" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "equipmentId" TEXT,
    "batchId" TEXT,
    "shiftId" TEXT,
    "stageCode" TEXT,
    "category" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "workOrderId" TEXT,
    "reportedById" TEXT NOT NULL,
    "releasedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MillingDowntime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingGeneratorRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "equipmentId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "litres" DECIMAL(10,2) NOT NULL,
    "meterStart" DECIMAL(12,1),
    "meterEnd" DECIMAL(12,1),
    "reason" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MillingGeneratorRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MillingProductionOrder_companyId_productionDate_idx" ON "MillingProductionOrder"("companyId", "productionDate");

-- CreateIndex
CREATE UNIQUE INDEX "MillingProductionOrder_companyId_code_key" ON "MillingProductionOrder"("companyId", "code");

-- CreateIndex
CREATE INDEX "MillingProductionOrderLine_orderId_idx" ON "MillingProductionOrderLine"("orderId");

-- CreateIndex
CREATE INDEX "MillingShift_companyId_scheduledStart_idx" ON "MillingShift"("companyId", "scheduledStart");

-- CreateIndex
CREATE UNIQUE INDEX "MillingShift_companyId_code_key" ON "MillingShift"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "MillingShiftAssignment_shiftId_employeeId_key" ON "MillingShiftAssignment"("shiftId", "employeeId");

-- CreateIndex
CREATE INDEX "MillingBatch_companyId_status_idx" ON "MillingBatch"("companyId", "status");

-- CreateIndex
CREATE INDEX "MillingBatch_orderId_idx" ON "MillingBatch"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "MillingBatch_companyId_code_key" ON "MillingBatch"("companyId", "code");

-- CreateIndex
CREATE INDEX "MillingBatchSourceLot_batchId_idx" ON "MillingBatchSourceLot"("batchId");

-- CreateIndex
CREATE INDEX "MillingBatchSourceLot_lotId_idx" ON "MillingBatchSourceLot"("lotId");

-- CreateIndex
CREATE INDEX "MillingStageRecord_batchId_idx" ON "MillingStageRecord"("batchId");

-- CreateIndex
CREATE INDEX "MillingBatchOutput_batchId_idx" ON "MillingBatchOutput"("batchId");

-- CreateIndex
CREATE INDEX "MillingPackRun_companyId_packedAt_idx" ON "MillingPackRun"("companyId", "packedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MillingPackRun_companyId_code_key" ON "MillingPackRun"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "MillingEquipmentState_equipmentId_key" ON "MillingEquipmentState"("equipmentId");

-- CreateIndex
CREATE INDEX "MillingEquipmentState_companyId_availability_idx" ON "MillingEquipmentState"("companyId", "availability");

-- CreateIndex
CREATE INDEX "MillingDowntime_companyId_startedAt_idx" ON "MillingDowntime"("companyId", "startedAt");

-- CreateIndex
CREATE INDEX "MillingDowntime_equipmentId_startedAt_idx" ON "MillingDowntime"("equipmentId", "startedAt");

-- CreateIndex
CREATE INDEX "MillingGeneratorRun_companyId_startedAt_idx" ON "MillingGeneratorRun"("companyId", "startedAt");

-- AddForeignKey
ALTER TABLE "MillingProductionOrderLine" ADD CONSTRAINT "MillingProductionOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MillingProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MillingShiftAssignment" ADD CONSTRAINT "MillingShiftAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "MillingShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MillingBatchSourceLot" ADD CONSTRAINT "MillingBatchSourceLot_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MillingBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MillingStageRecord" ADD CONSTRAINT "MillingStageRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MillingBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MillingBatchOutput" ADD CONSTRAINT "MillingBatchOutput_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MillingBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

