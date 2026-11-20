-- Seller commission paid separately from payroll, through a paid Books bill.

-- AlterTable
ALTER TABLE "MillingSeller" ADD COLUMN     "vendorId" TEXT;

-- CreateTable
CREATE TABLE "MillingSellerCommissionPayout" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "billId" TEXT,
    "paidById" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "MillingSellerCommissionPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MillingSellerCommissionPayout_companyId_sellerId_idx" ON "MillingSellerCommissionPayout"("companyId", "sellerId");

ALTER TABLE "MillingSellerCommissionPayout" ADD CONSTRAINT "MillingSellerCommissionPayout_amount_check" CHECK ("amount" > 0);
