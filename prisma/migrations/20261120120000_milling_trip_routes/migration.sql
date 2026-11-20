-- A trip remembers the customer route it ran.

-- AlterTable
ALTER TABLE "MillingDelivery" ADD COLUMN     "routeId" TEXT;

-- CreateIndex
CREATE INDEX "MillingDelivery_routeId_idx" ON "MillingDelivery"("routeId");
