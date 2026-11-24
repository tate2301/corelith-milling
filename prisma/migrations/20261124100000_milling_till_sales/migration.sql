-- The mill's own till (Sell): bags sold at the office from a store, or on the road from a seller's trip.

-- CreateTable
CREATE TABLE "MillingSale" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "stockLocationId" TEXT,
    "tripId" TEXT,
    "customerId" TEXT,
    "customerName" TEXT,
    "payment" TEXT NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SOLD',
    "soldById" TEXT NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "notes" TEXT,
    "invoiceId" TEXT,
    "booksReference" TEXT,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "MillingSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingSaleLine" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "bags" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "discountPerBag" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "MillingSaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MillingSale_companyId_code_key" ON "MillingSale"("companyId", "code");

-- CreateIndex
CREATE INDEX "MillingSale_companyId_soldAt_idx" ON "MillingSale"("companyId", "soldAt");

-- CreateIndex
CREATE INDEX "MillingSale_tripId_idx" ON "MillingSale"("tripId");

-- CreateIndex
CREATE INDEX "MillingSaleLine_saleId_idx" ON "MillingSaleLine"("saleId");

-- AddForeignKey
ALTER TABLE "MillingSaleLine" ADD CONSTRAINT "MillingSaleLine_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "MillingSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MillingSale" ADD CONSTRAINT "MillingSale_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "MillingSellerTrip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "MillingSale" ADD CONSTRAINT "MillingSale_source_check" CHECK ("source" IN ('OFFICE', 'TRIP'));
ALTER TABLE "MillingSale" ADD CONSTRAINT "MillingSale_payment_check" CHECK ("payment" IN ('CASH', 'ECOCASH', 'ON_ACCOUNT'));
ALTER TABLE "MillingSale" ADD CONSTRAINT "MillingSale_status_check" CHECK ("status" IN ('SOLD', 'VOIDED'));
ALTER TABLE "MillingSaleLine" ADD CONSTRAINT "MillingSaleLine_figures_check" CHECK ("bags" > 0 AND "unitPrice" >= 0 AND "discountPerBag" >= 0);
