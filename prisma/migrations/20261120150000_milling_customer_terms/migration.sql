-- A customer's credit limit and payment terms at the mill.

-- CreateTable
CREATE TABLE "MillingCustomerTerms" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "creditLimit" DECIMAL(12,2),
    "termsDays" INTEGER NOT NULL DEFAULT 14,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "MillingCustomerTerms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MillingCustomerTerms_companyId_customerId_key" ON "MillingCustomerTerms"("companyId", "customerId");

ALTER TABLE "MillingCustomerTerms" ADD CONSTRAINT "MillingCustomerTerms_figures_check" CHECK (("creditLimit" IS NULL OR "creditLimit" >= 0) AND "termsDays" >= 0);
