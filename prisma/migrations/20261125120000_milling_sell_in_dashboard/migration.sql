-- The mill sells from the dashboard (Gate sales › Sell), not from core's till
-- on the `pos.` address. Switch the till, its shifts and its portal off for
-- every workspace running the mill. TEMPLATE_MILLING leaves them off for new
-- workspaces; this covers workspaces provisioned before. A workspace can
-- switch them back on in platform admin.
UPDATE "CompanyFeatureFlag" AS flag
SET "isEnabled" = false,
    "reason" = 'The mill sells from the dashboard',
    "updatedAt" = CURRENT_TIMESTAMP
FROM "PlatformFeature" AS feature
WHERE flag."featureId" = feature."id"
  AND feature."key" IN ('retail.pos', 'retail.shifts', 'portal.pos')
  AND flag."isEnabled" = true
  AND flag."companyId" IN (
    SELECT mill."companyId"
    FROM "CompanyFeatureFlag" AS mill
    JOIN "PlatformFeature" AS milling ON milling."id" = mill."featureId"
    WHERE milling."key" = 'milling.home' AND mill."isEnabled" = true
  );
