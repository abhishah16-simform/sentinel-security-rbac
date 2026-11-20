-- CreateTable
CREATE TABLE "audit_chain_heads" (
    "chain" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_chain_heads_pkey" PRIMARY KEY ("chain")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "eventType" TEXT NOT NULL,
    "actorUserId" UUID,
    "targetType" TEXT,
    "targetId" TEXT,
    "applicationId" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seq" INTEGER,
    "prevHash" TEXT,
    "hash" TEXT,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_tenantId_createdAt_idx" ON "audit_events"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_tenantId_actorUserId_createdAt_idx" ON "audit_events"("tenantId", "actorUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "audit_events_tenantId_seq_key" ON "audit_events"("tenantId", "seq");

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-Level Security (hand-written; Prisma can't generate it)
-- ---------------------------------------------------------------------------

-- audit_events holds every chain. FORCE because the app's role owns the table (ADR 0003).
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;

-- A Tenant's entries, inside that Tenant's context.
CREATE POLICY tenant_isolation ON "audit_events"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- Platform-level entries (null tenantId), only when no Tenant context is set, so a Tenant-scoped
-- request can never read or write the platform chain.
CREATE POLICY platform_events ON "audit_events"
  USING ("tenantId" IS NULL AND app_current_tenant_id() IS NULL)
  WITH CHECK ("tenantId" IS NULL AND app_current_tenant_id() IS NULL);

-- ---------------------------------------------------------------------------
-- Append-only: the app never changes or removes an entry. The hash chain still detects tampering
-- by anyone who gets around this (a superuser disabling the trigger, say).
-- ---------------------------------------------------------------------------

CREATE FUNCTION audit_events_append_only() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP;
END
$$;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON "audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only();
