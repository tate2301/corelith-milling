-- CreateEnum
CREATE TYPE "EquipmentMeterType" AS ENUM ('NONE', 'HOURS', 'KM');

-- CreateEnum
CREATE TYPE "OvertimeDayKind" AS ENUM ('WORKDAY', 'REST_DAY', 'HOLIDAY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AccountingSourceType" ADD VALUE 'PRODUCTION_ISSUE';
ALTER TYPE "AccountingSourceType" ADD VALUE 'PRODUCTION_OUTPUT';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "routeId" TEXT,
ADD COLUMN     "routeStop" INTEGER;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "restDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "Equipment" ADD COLUMN     "currentMeter" DECIMAL(12,1),
ADD COLUMN     "meterReadAt" TIMESTAMP(3),
ADD COLUMN     "meterType" "EquipmentMeterType" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "registrationNumber" TEXT;

-- AlterTable
ALTER TABLE "RetailSaleLine" ADD COLUMN     "netWeightKg" DECIMAL(10,3);

-- AlterTable
ALTER TABLE "SalesInvoiceLine" ADD COLUMN     "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "netWeightKg" DECIMAL(10,3),
ADD COLUMN     "productId" TEXT;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "equipmentId" TEXT,
ADD COLUMN     "meterReading" DECIMAL(12,1);

-- CreateTable
CREATE TABLE "MeterReading" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "reading" DECIMAL(12,1) NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeterReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerRoute" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visitDays" INTEGER[],
    "repUserId" TEXT,
    "vehicleId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OvertimeBand" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dayKind" "OvertimeDayKind" NOT NULL,
    "fromHours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "toHours" DECIMAL(5,2),
    "multiplier" DECIMAL(4,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OvertimeBand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeterReading_equipmentId_readAt_idx" ON "MeterReading"("equipmentId", "readAt");

-- CreateIndex
CREATE INDEX "MeterReading_companyId_readAt_idx" ON "MeterReading"("companyId", "readAt");

-- CreateIndex
CREATE INDEX "MeterReading_source_sourceId_idx" ON "MeterReading"("source", "sourceId");

-- CreateIndex
CREATE INDEX "CustomerRoute_companyId_isActive_idx" ON "CustomerRoute"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRoute_companyId_code_key" ON "CustomerRoute"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "OvertimeBand_companyId_dayKind_fromHours_key" ON "OvertimeBand"("companyId", "dayKind", "fromHours");

-- CreateIndex
CREATE INDEX "Customer_routeId_routeStop_idx" ON "Customer"("routeId", "routeStop");

-- CreateIndex
CREATE INDEX "SalesInvoiceLine_productId_idx" ON "SalesInvoiceLine"("productId");

-- CreateIndex
CREATE INDEX "StockMovement_equipmentId_createdAt_idx" ON "StockMovement"("equipmentId", "createdAt");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "CustomerRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoiceLine" ADD CONSTRAINT "SalesInvoiceLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRoute" ADD CONSTRAINT "CustomerRoute_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRoute" ADD CONSTRAINT "CustomerRoute_repUserId_fkey" FOREIGN KEY ("repUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRoute" ADD CONSTRAINT "CustomerRoute_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeBand" ADD CONSTRAINT "OvertimeBand_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
