-- Seller trips: employees take packed bags out to sell, bring back what is left,
-- and account for the rest. See lib/milling/sellers/trips.ts.

-- AlterTable
ALTER TABLE "MillingSettings" ADD COLUMN     "sellerDiscountStep" DECIMAL(8,2) NOT NULL DEFAULT 0.1,
ADD COLUMN     "sellerMaxDiscount" DECIMAL(8,2) NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "MillingSeller" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "MillingSeller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingSellerRate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "commissionPerBag" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "commissionPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "MillingSellerRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingSellerTrip" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "tripDate" DATE NOT NULL,
    "siteId" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "withSellersLocationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OUT',
    "issuedById" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "owedAtIssue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "overrideById" TEXT,
    "overrideReason" TEXT,
    "settledById" TEXT,
    "settledAt" TIMESTAMP(3),
    "grossAmount" DECIMAL(12,2),
    "discountAmount" DECIMAL(12,2),
    "amountDue" DECIMAL(12,2),
    "cashReceived" DECIMAL(12,2),
    "shortage" DECIMAL(12,2),
    "commissionAmount" DECIMAL(12,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MillingSellerTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingSellerTripLine" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "reservationId" TEXT,
    "bagsOut" INTEGER NOT NULL,
    "bagsBack" INTEGER,
    "bagsSold" INTEGER,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "commissionPerBag" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "commissionPct" DECIMAL(5,2) NOT NULL DEFAULT 0,

    CONSTRAINT "MillingSellerTripLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingSellerDiscount" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "discount" DECIMAL(8,2) NOT NULL,
    "bags" INTEGER NOT NULL,

    CONSTRAINT "MillingSellerDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingSellerPayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "tripId" TEXT,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "receivedById" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "MillingSellerPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MillingSeller_companyId_employeeId_key" ON "MillingSeller"("companyId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "MillingSellerRate_companyId_productId_key" ON "MillingSellerRate"("companyId", "productId");

-- CreateIndex
CREATE INDEX "MillingSellerTrip_companyId_status_idx" ON "MillingSellerTrip"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MillingSellerTrip_companyId_code_key" ON "MillingSellerTrip"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "MillingSellerTrip_companyId_sellerId_tripDate_key" ON "MillingSellerTrip"("companyId", "sellerId", "tripDate");

-- CreateIndex
CREATE INDEX "MillingSellerTripLine_tripId_idx" ON "MillingSellerTripLine"("tripId");

-- CreateIndex
CREATE INDEX "MillingSellerDiscount_tripId_idx" ON "MillingSellerDiscount"("tripId");

-- CreateIndex
CREATE INDEX "MillingSellerPayment_companyId_sellerId_idx" ON "MillingSellerPayment"("companyId", "sellerId");

-- AddForeignKey
ALTER TABLE "MillingSellerTripLine" ADD CONSTRAINT "MillingSellerTripLine_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "MillingSellerTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MillingSellerDiscount" ADD CONSTRAINT "MillingSellerDiscount_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "MillingSellerTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The service checks these first; the database holds the line if a caller does not.
ALTER TABLE "MillingSellerTripLine" ADD CONSTRAINT "MillingSellerTripLine_bags_check"
  CHECK ("bagsOut" > 0 AND ("bagsBack" IS NULL OR ("bagsBack" >= 0 AND "bagsBack" <= "bagsOut")) AND ("bagsSold" IS NULL OR "bagsSold" >= 0));
ALTER TABLE "MillingSellerDiscount" ADD CONSTRAINT "MillingSellerDiscount_positive_check"
  CHECK ("discount" > 0 AND "bags" > 0);
ALTER TABLE "MillingSellerPayment" ADD CONSTRAINT "MillingSellerPayment_amount_check"
  CHECK ("amount" >= 0);
