-- L4: customer orders, deliveries with proof of delivery, and matching gate sales to lots.
-- CreateTable
CREATE TABLE "MillingCustomerOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "destinationId" TEXT,
    "requiredDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MillingCustomerOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingCustomerOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "bags" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2),

    CONSTRAINT "MillingCustomerOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingDelivery" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT,
    "destinationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "loadKg" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "odometerOut" DECIMAL(10,1),
    "odometerIn" DECIMAL(10,1),
    "fuelLitres" DECIMAL(8,2),
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "receivedBy" TEXT,
    "signatureUrl" TEXT,
    "photoUrl" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MillingDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingDeliveryLine" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "stockLocationId" TEXT NOT NULL,
    "reservationId" TEXT,
    "bags" INTEGER NOT NULL,
    "deliveredBags" INTEGER,
    "shortBags" INTEGER NOT NULL DEFAULT 0,
    "damagedBags" INTEGER NOT NULL DEFAULT 0,
    "returnedBags" INTEGER NOT NULL DEFAULT 0,
    "returnLotId" TEXT,

    CONSTRAINT "MillingDeliveryLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MillingCustomerOrder_companyId_status_idx" ON "MillingCustomerOrder"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MillingCustomerOrder_companyId_code_key" ON "MillingCustomerOrder"("companyId", "code");

-- CreateIndex
CREATE INDEX "MillingCustomerOrderLine_orderId_idx" ON "MillingCustomerOrderLine"("orderId");

-- CreateIndex
CREATE INDEX "MillingDelivery_companyId_status_idx" ON "MillingDelivery"("companyId", "status");

-- CreateIndex
CREATE INDEX "MillingDelivery_driverId_status_idx" ON "MillingDelivery"("driverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MillingDelivery_companyId_code_key" ON "MillingDelivery"("companyId", "code");

-- CreateIndex
CREATE INDEX "MillingDeliveryLine_deliveryId_idx" ON "MillingDeliveryLine"("deliveryId");

-- CreateIndex
CREATE INDEX "MillingDeliveryLine_orderId_idx" ON "MillingDeliveryLine"("orderId");

-- CreateIndex
CREATE INDEX "MillingLotMovement_stockMovementId_idx" ON "MillingLotMovement"("stockMovementId");

-- AddForeignKey
ALTER TABLE "MillingCustomerOrderLine" ADD CONSTRAINT "MillingCustomerOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MillingCustomerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MillingDeliveryLine" ADD CONSTRAINT "MillingDeliveryLine_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "MillingDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

