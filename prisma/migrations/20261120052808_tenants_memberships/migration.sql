-- AlterTable
ALTER TABLE "refresh_chains" ADD COLUMN     "activeMembershipId" UUID,
ADD COLUMN     "activeTenantId" UUID;

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "isTenantAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memberships_userId_idx" ON "memberships"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenantId_userId_key" ON "memberships"("tenantId", "userId");

-- AddForeignKey
ALTER TABLE "refresh_chains" ADD CONSTRAINT "refresh_chains_activeTenantId_fkey" FOREIGN KEY ("activeTenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_chains" ADD CONSTRAINT "refresh_chains_activeMembershipId_fkey" FOREIGN KEY ("activeMembershipId") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-Level Security (hand-written; Prisma can't generate it)
-- ---------------------------------------------------------------------------

-- The Tenant and User contexts a transaction runs in, set with SET LOCAL / set_config(..., true).
-- NULLIF: after a SET LOCAL ends, the setting reads as '' rather than NULL on that connection.
CREATE FUNCTION app_current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- memberships is Tenant-owned. FORCE because the app's role owns the table (ADR 0003).
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;

-- Reads and writes inside the Active Tenant.
CREATE POLICY tenant_isolation ON "memberships"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- A User may read their own Memberships in every Tenant (the Tenant picker). Read-only.
CREATE POLICY own_memberships ON "memberships"
  FOR SELECT
  USING ("userId" = app_current_user_id());
