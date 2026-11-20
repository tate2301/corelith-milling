-- Seller trips in Books: the seller's customer record, each trip's invoice, and when money went in.

-- AlterTable
ALTER TABLE "MillingSeller" ADD COLUMN     "customerId" TEXT;

-- AlterTable
ALTER TABLE "MillingSellerPayment" ADD COLUMN     "booksReference" TEXT,
ADD COLUMN     "postedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MillingSellerTrip" ADD COLUMN     "invoiceId" TEXT;
