-- The mill's settings: route, QC checks, destinations, duties, recipes, location and vehicle profiles.
-- No foreign keys to core tables: docs/milling/DECISIONS.md, D2.
-- CreateTable
CREATE TABLE "MillingSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reconciliationTolerancePct" DECIMAL(5,2) NOT NULL DEFAULT 2,
    "defaultIntakeBagKg" DECIMAL(8,2) NOT NULL DEFAULT 50,
    "shiftHours" DECIMAL(4,2) NOT NULL DEFAULT 8.5,
    "shiftCrewSize" INTEGER NOT NULL DEFAULT 7,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "MillingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingLocationProfile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "stockLocationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "capacityKg" DECIMAL(14,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MillingLocationProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingProcessStage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "capturesQuantities" BOOLEAN NOT NULL DEFAULT true,
    "equipmentCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MillingProcessStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingQcSpec" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "point" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "resultType" TEXT NOT NULL,
    "unit" TEXT,
    "minValue" DECIMAL(12,3),
    "maxValue" DECIMAL(12,3),
    "guidance" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MillingQcSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingDestination" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "distanceKm" DECIMAL(8,1),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MillingDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingVehicleProfile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "capacityKg" DECIMAL(10,2),
    "driverUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MillingVehicleProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingShiftDuty" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MillingShiftDuty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingPackRecipe" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "packedProductId" TEXT NOT NULL,
    "bulkProductId" TEXT NOT NULL,
    "bagProductId" TEXT,
    "kgPerBag" DECIMAL(8,3) NOT NULL,
    "threadPerBag" DECIMAL(8,4),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MillingPackRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MillingSettings_companyId_key" ON "MillingSettings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "MillingLocationProfile_stockLocationId_key" ON "MillingLocationProfile"("stockLocationId");

-- CreateIndex
CREATE INDEX "MillingLocationProfile_companyId_idx" ON "MillingLocationProfile"("companyId");

-- CreateIndex
CREATE INDEX "MillingProcessStage_companyId_sequence_idx" ON "MillingProcessStage"("companyId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "MillingProcessStage_companyId_code_key" ON "MillingProcessStage"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "MillingQcSpec_companyId_point_code_key" ON "MillingQcSpec"("companyId", "point", "code");

-- CreateIndex
CREATE UNIQUE INDEX "MillingDestination_companyId_code_key" ON "MillingDestination"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "MillingVehicleProfile_equipmentId_key" ON "MillingVehicleProfile"("equipmentId");

-- CreateIndex
CREATE INDEX "MillingVehicleProfile_companyId_idx" ON "MillingVehicleProfile"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "MillingShiftDuty_companyId_code_key" ON "MillingShiftDuty"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "MillingPackRecipe_packedProductId_key" ON "MillingPackRecipe"("packedProductId");

-- CreateIndex
CREATE INDEX "MillingPackRecipe_companyId_idx" ON "MillingPackRecipe"("companyId");

