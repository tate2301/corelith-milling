-- Opening stock as a document: counted, previewed, then posted to stock and Books once.

-- CreateTable
CREATE TABLE "MillingOpeningStock" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "asOf" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "MillingOpeningStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingOpeningStockLine" (
    "id" TEXT NOT NULL,
    "openingId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "stockLocationId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "lotId" TEXT,
    "journalEntryId" TEXT,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MillingOpeningStockLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MillingOpeningStock_companyId_status_idx" ON "MillingOpeningStock"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MillingOpeningStock_companyId_code_key" ON "MillingOpeningStock"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "MillingOpeningStockLine_openingId_productId_stockLocationId_key" ON "MillingOpeningStockLine"("openingId", "productId", "stockLocationId");

-- AddForeignKey
ALTER TABLE "MillingOpeningStockLine" ADD CONSTRAINT "MillingOpeningStockLine_openingId_fkey" FOREIGN KEY ("openingId") REFERENCES "MillingOpeningStock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MillingOpeningStockLine" ADD CONSTRAINT "MillingOpeningStockLine_figures_check" CHECK ("quantity" > 0 AND "unitCost" >= 0);
