-- Preventive maintenance plans (by time, by meter, or whichever comes first), technicians as their own
-- records, work orders that know whether they are a breakdown or a service, and vehicles told from machines.

-- CreateEnum
CREATE TYPE "WorkOrderKind" AS ENUM ('BREAKDOWN', 'PREVENTIVE');

-- CreateEnum
CREATE TYPE "EquipmentKind" AS ENUM ('MACHINE', 'VEHICLE');

-- AlterTable
ALTER TABLE "Equipment" ADD COLUMN     "commissionedAt" TIMESTAMP(3),
ADD COLUMN     "kind" "EquipmentKind" NOT NULL DEFAULT 'MACHINE',
ADD COLUMN     "make" TEXT,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "serialNumber" TEXT;

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "kind" "WorkOrderKind" NOT NULL DEFAULT 'BREAKDOWN',
ADD COLUMN     "meterAtService" DECIMAL(12,1),
ADD COLUMN     "planId" TEXT,
ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MaintenancePlan" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tasks" TEXT,
    "intervalDays" INTEGER,
    "intervalMeter" DECIMAL(12,1),
    "leadDays" INTEGER NOT NULL DEFAULT 7,
    "autoRaise" BOOLEAN NOT NULL DEFAULT true,
    "technicianId" TEXT,
    "lastDoneAt" TIMESTAMP(3),
    "lastDoneMeter" DECIMAL(12,1),
    "nextDueAt" TIMESTAMP(3),
    "nextDueMeter" DECIMAL(12,1),
    "nextDueBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenancePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceTechnician" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "trade" TEXT,
    "hourlyRate" DECIMAL(10,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceTechnician_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenancePlan_companyId_nextDueAt_idx" ON "MaintenancePlan"("companyId", "nextDueAt");

-- CreateIndex
CREATE INDEX "MaintenancePlan_equipmentId_idx" ON "MaintenancePlan"("equipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceTechnician_employeeId_key" ON "MaintenanceTechnician"("employeeId");

-- CreateIndex
CREATE INDEX "MaintenanceTechnician_companyId_idx" ON "MaintenanceTechnician"("companyId");

-- CreateIndex
CREATE INDEX "WorkOrder_planId_idx" ON "WorkOrder"("planId");

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MaintenancePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceTechnician" ADD CONSTRAINT "MaintenanceTechnician_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceTechnician" ADD CONSTRAINT "MaintenanceTechnician_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Vehicles: what the register already treats as one (the category, or a number plate).
UPDATE "Equipment" SET "kind" = 'VEHICLE' WHERE upper("category") = 'VEHICLE' OR "registrationNumber" IS NOT NULL;

-- The service interval each machine carried becomes its first preventive plan, due when the old
-- column said; its next due is worked out again at its first service. The old columns stay this
-- release (add first, remove later).
INSERT INTO "MaintenancePlan" ("id", "companyId", "equipmentId", "name", "intervalDays", "intervalMeter", "lastDoneAt", "nextDueAt", "nextDueBy", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s."companyId", e."id",
       CASE WHEN e."serviceDays" IS NOT NULL THEN 'Service every ' || e."serviceDays" || ' days' ELSE 'Service every ' || e."serviceHours" || ' hours' END,
       e."serviceDays",
       CASE WHEN e."meterType" = 'HOURS' THEN e."serviceHours" ELSE NULL END,
       e."lastServiceDate", e."nextServiceDue", CASE WHEN e."nextServiceDue" IS NOT NULL THEN 'DATE' ELSE NULL END,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Equipment" e JOIN "Site" s ON s."id" = e."siteId"
WHERE e."isActive" AND (e."serviceDays" IS NOT NULL OR (e."serviceHours" IS NOT NULL AND e."meterType" = 'HOURS'));

-- Row security, as on WorkOrder: every login as before, Vane's and Explore's readers in their own workspace.
ALTER TABLE "MaintenancePlan" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_all" ON "MaintenancePlan" AS PERMISSIVE FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY "vane_workspace" ON "MaintenancePlan" AS RESTRICTIVE FOR SELECT TO vane_reader USING ("companyId" = (SELECT s."companyId" FROM "VaneReaderScope" s WHERE s."pid" = pg_backend_pid()));
CREATE POLICY "explore_workspace" ON "MaintenancePlan" AS RESTRICTIVE FOR SELECT TO explore_reader USING ('MaintenancePlan' = ANY (COALESCE((SELECT s."tables" FROM "ExploreReaderScope" s WHERE s."pid" = pg_backend_pid()), ARRAY[]::text[])) AND "companyId" = (SELECT s."companyId" FROM "ExploreReaderScope" s WHERE s."pid" = pg_backend_pid()));

ALTER TABLE "MaintenanceTechnician" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_all" ON "MaintenanceTechnician" AS PERMISSIVE FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY "vane_workspace" ON "MaintenanceTechnician" AS RESTRICTIVE FOR SELECT TO vane_reader USING ("companyId" = (SELECT s."companyId" FROM "VaneReaderScope" s WHERE s."pid" = pg_backend_pid()));
CREATE POLICY "explore_workspace" ON "MaintenanceTechnician" AS RESTRICTIVE FOR SELECT TO explore_reader USING ('MaintenanceTechnician' = ANY (COALESCE((SELECT s."tables" FROM "ExploreReaderScope" s WHERE s."pid" = pg_backend_pid()), ARRAY[]::text[])) AND "companyId" = (SELECT s."companyId" FROM "ExploreReaderScope" s WHERE s."pid" = pg_backend_pid()));

ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_interval_check" CHECK (("intervalDays" IS NOT NULL AND "intervalDays" > 0) OR ("intervalMeter" IS NOT NULL AND "intervalMeter" > 0));
