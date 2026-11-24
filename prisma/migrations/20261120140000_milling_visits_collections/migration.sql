-- Rep visits and market survey answers, promises to pay, and the extraction target.

-- AlterTable
ALTER TABLE "MillingSettings" ADD COLUMN     "extractionTargetPct" DECIMAL(5,2) NOT NULL DEFAULT 72;

-- CreateTable
CREATE TABLE "MillingVisit" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "routeId" TEXT,
    "repUserId" TEXT NOT NULL,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "competitorPrice" DECIMAL(10,2),
    "ourBagsOnShelf" INTEGER,
    "shelfSharePct" DECIMAL(5,2),
    "photoUrl" TEXT,
    "note" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),

    CONSTRAINT "MillingVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingPaymentPromise" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "promisedFor" DATE NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MillingPaymentPromise_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MillingVisit_companyId_visitedAt_idx" ON "MillingVisit"("companyId", "visitedAt");

-- CreateIndex
CREATE INDEX "MillingVisit_companyId_customerId_idx" ON "MillingVisit"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "MillingVisit_companyId_routeId_idx" ON "MillingVisit"("companyId", "routeId");

-- CreateIndex
CREATE INDEX "MillingPaymentPromise_companyId_customerId_idx" ON "MillingPaymentPromise"("companyId", "customerId");

ALTER TABLE "MillingVisit" ADD CONSTRAINT "MillingVisit_figures_check" CHECK (("competitorPrice" IS NULL OR "competitorPrice" >= 0) AND ("ourBagsOnShelf" IS NULL OR "ourBagsOnShelf" >= 0) AND ("shelfSharePct" IS NULL OR ("shelfSharePct" >= 0 AND "shelfSharePct" <= 100)));
ALTER TABLE "MillingPaymentPromise" ADD CONSTRAINT "MillingPaymentPromise_amount_check" CHECK ("amount" > 0);
