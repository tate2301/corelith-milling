-- Grandmeal's production run (docs/milling/grandmeal-workflow.md, Stage 1)
-- and cost treatments (Workspace setup).

CREATE TABLE "MillingProductionRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "bags" INTEGER NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "producedOn" DATE NOT NULL,
    "outputLotId" TEXT NOT NULL,
    "stockLocationId" TEXT NOT NULL,
    "recipeInputKg" DECIMAL(14,3) NOT NULL,
    "actualInputKg" DECIMAL(14,3) NOT NULL,
    "yieldVarianceKg" DECIMAL(14,3) NOT NULL,
    "bagCost" DECIMAL(12,4),
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MillingProductionRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MillingProductionRun_figures_check" CHECK ("bags" > 0 AND "recipeInputKg" >= 0 AND "actualInputKg" >= 0)
);
CREATE UNIQUE INDEX "MillingProductionRun_companyId_code_key" ON "MillingProductionRun"("companyId", "code");
CREATE INDEX "MillingProductionRun_companyId_producedOn_idx" ON "MillingProductionRun"("companyId", "producedOn");

CREATE TABLE "MillingCostTreatment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "treatment" TEXT NOT NULL,
    "setById" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MillingCostTreatment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MillingCostTreatment_treatment_check" CHECK ("treatment" IN ('COST_OF_SALES', 'OPERATING_EXPENSE', 'ASSET'))
);
CREATE UNIQUE INDEX "MillingCostTreatment_productId_key" ON "MillingCostTreatment"("productId");
CREATE INDEX "MillingCostTreatment_companyId_idx" ON "MillingCostTreatment"("companyId");
