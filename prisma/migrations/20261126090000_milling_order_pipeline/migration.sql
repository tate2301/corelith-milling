-- Grandmeal's order pipeline (docs/milling/grandmeal-workflow.md, Stage 2):
-- Pending → Ongoing → Complete → Closed, or Cancelled; the marketing agent
-- who logged it and the sales rep it is assigned to; order lines in tonnes;
-- discount vouchers, one live voucher a customer, applied to a line.

ALTER TABLE "MillingCustomerOrder"
  ALTER COLUMN "status" SET DEFAULT 'PENDING',
  ADD COLUMN "marketingAgentId" TEXT,
  ADD COLUMN "salesRepId" TEXT,
  ADD COLUMN "assignedById" TEXT,
  ADD COLUMN "assignedAt" TIMESTAMP(3),
  ADD COLUMN "ongoingAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "closedAt" TIMESTAMP(3),
  ADD COLUMN "closedById" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledById" TEXT,
  ADD COLUMN "cancelReason" TEXT;

-- The old statuses, as the spec names them.
UPDATE "MillingCustomerOrder" SET "status" = 'PENDING' WHERE "status" = 'DRAFT';
UPDATE "MillingCustomerOrder" SET "status" = 'ONGOING', "ongoingAt" = "updatedAt" WHERE "status" IN ('CONFIRMED', 'IN_DELIVERY');
UPDATE "MillingCustomerOrder" SET "status" = 'COMPLETE', "completedAt" = "updatedAt" WHERE "status" = 'DELIVERED';
UPDATE "MillingCustomerOrder" SET "closedAt" = "updatedAt" WHERE "status" = 'CLOSED';
-- Whoever took an order before is its marketing agent.
UPDATE "MillingCustomerOrder" SET "marketingAgentId" = "createdById" WHERE "marketingAgentId" IS NULL;

ALTER TABLE "MillingCustomerOrder" ADD CONSTRAINT "MillingCustomerOrder_status_check"
  CHECK ("status" IN ('PENDING', 'ONGOING', 'COMPLETE', 'CLOSED', 'CANCELLED'));
CREATE INDEX "MillingCustomerOrder_salesRepId_status_idx" ON "MillingCustomerOrder"("salesRepId", "status");
CREATE INDEX "MillingCustomerOrder_marketingAgentId_idx" ON "MillingCustomerOrder"("marketingAgentId");

ALTER TABLE "MillingCustomerOrderLine"
  ADD COLUMN "enteredTonnes" DECIMAL(10,3),
  ADD COLUMN "voucherId" TEXT,
  ADD COLUMN "discount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "MillingCustomerOrderLine" ADD CONSTRAINT "MillingCustomerOrderLine_discount_check" CHECK ("discount" >= 0);

CREATE TABLE "MillingVoucher" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "expiresOn" DATE NOT NULL,
    "useLimit" INTEGER NOT NULL DEFAULT 1,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "issuedById" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MillingVoucher_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MillingVoucher_kind_check" CHECK ("kind" IN ('PERCENT', 'PER_BAG', 'FIXED')),
    CONSTRAINT "MillingVoucher_status_check" CHECK ("status" IN ('ACTIVE', 'USED', 'VOID')),
    CONSTRAINT "MillingVoucher_figures_check" CHECK ("value" > 0 AND "useLimit" > 0 AND "uses" >= 0 AND "uses" <= "useLimit" AND ("kind" <> 'PERCENT' OR "value" <= 100))
);
CREATE UNIQUE INDEX "MillingVoucher_companyId_code_key" ON "MillingVoucher"("companyId", "code");
CREATE INDEX "MillingVoucher_companyId_customerId_status_idx" ON "MillingVoucher"("companyId", "customerId", "status");

CREATE TABLE "MillingVoucherUse" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "orderLineId" TEXT,
    "saleLineId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "usedById" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MillingVoucherUse_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MillingVoucherUse_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "MillingVoucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MillingVoucherUse_target_check" CHECK (("orderLineId" IS NOT NULL) <> ("saleLineId" IS NOT NULL)),
    CONSTRAINT "MillingVoucherUse_amount_check" CHECK ("amount" >= 0)
);
CREATE INDEX "MillingVoucherUse_voucherId_idx" ON "MillingVoucherUse"("voucherId");
