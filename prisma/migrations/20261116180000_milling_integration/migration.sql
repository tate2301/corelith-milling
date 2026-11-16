-- Integration: intake price and Books bill, order invoice, exceptions notified.
-- AlterTable
ALTER TABLE "MillingCustomerOrder" ADD COLUMN     "invoiceId" TEXT;

-- AlterTable
ALTER TABLE "MillingException" ADD COLUMN     "notifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MillingIntake" ADD COLUMN     "billId" TEXT,
ADD COLUMN     "pricePerTonne" DECIMAL(12,2);

