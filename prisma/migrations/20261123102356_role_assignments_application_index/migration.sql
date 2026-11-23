-- CreateIndex
CREATE INDEX "role_assignments_tenantId_applicationId_idx" ON "role_assignments"("tenantId", "applicationId");
