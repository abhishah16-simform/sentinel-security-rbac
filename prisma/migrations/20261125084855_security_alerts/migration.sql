-- CreateEnum
CREATE TYPE "SecurityAlertRule" AS ENUM ('REPEATED_FAILED_LOGINS', 'REFRESH_TOKEN_REUSED', 'ACCESS_CHECK_DENIALS_SPIKE', 'TENANT_ADMIN_CHANGED');

-- CreateTable
CREATE TABLE "security_alerts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "rule" "SecurityAlertRule" NOT NULL,
    "auditEventId" UUID NOT NULL,
    "subjectUserId" UUID,
    "actorUserId" UUID,
    "applicationId" UUID,
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedByUserId" UUID,

    CONSTRAINT "security_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "security_alerts_tenantId_createdAt_idx" ON "security_alerts"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "security_alerts_tenantId_rule_createdAt_idx" ON "security_alerts"("tenantId", "rule", "createdAt");

-- AddForeignKey
ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_auditEventId_fkey" FOREIGN KEY ("auditEventId") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_acknowledgedByUserId_fkey" FOREIGN KEY ("acknowledgedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Row-Level Security (hand-written; Prisma can't generate it)
-- ---------------------------------------------------------------------------

-- security_alerts is Tenant-owned. FORCE because the app's role owns the table (ADR 0003).
ALTER TABLE "security_alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "security_alerts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "security_alerts"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- An alert can't name who acknowledged it without saying when. That User may later be gone
-- (SET NULL), so only the time is sure to stay.
ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_acknowledged_check"
  CHECK ("acknowledgedByUserId" IS NULL OR "acknowledgedAt" IS NOT NULL);

-- The denied-Access-Check rule counts one Application's denials in a Tenant over the last 5 minutes
-- on every denial; this keeps that count off the far larger stream of allowed checks.
CREATE INDEX "audit_events_denied_checks_idx"
  ON "audit_events"("tenantId", "applicationId", "createdAt") WHERE "eventType" = 'access_check.denied';