-- CreateTable
CREATE TABLE "registered_resources" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registered_resources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "registered_resources_tenantId_createdAt_idx" ON "registered_resources"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "registered_resources_tenantId_applicationId_resourceType_re_key" ON "registered_resources"("tenantId", "applicationId", "resourceType", "resourceId");

-- AddForeignKey
ALTER TABLE "registered_resources" ADD CONSTRAINT "registered_resources_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registered_resources" ADD CONSTRAINT "registered_resources_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-Level Security (hand-written; Prisma can't generate it)
-- ---------------------------------------------------------------------------

-- registered_resources is Tenant-owned. FORCE because the app's role owns the table (ADR 0003).
ALTER TABLE "registered_resources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "registered_resources" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "registered_resources"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- Attributes are always a JSON object, which Conditions are matched against.
ALTER TABLE "registered_resources" ADD CONSTRAINT "registered_resources_attributes_object_check"
  CHECK (jsonb_typeof("attributes") = 'object');
