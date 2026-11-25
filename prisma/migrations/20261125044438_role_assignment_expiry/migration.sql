-- AlterTable
ALTER TABLE "role_assignments" ADD COLUMN     "expiryRecordedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "role_assignments_tenantId_expiresAt_idx" ON "role_assignments"("tenantId", "expiresAt");

-- Only a Temporary Role Assignment can be marked as expired (hand-written; Prisma can't generate it).
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_expiry_recorded_check"
  CHECK ("expiryRecordedAt" IS NULL OR "expiresAt" IS NOT NULL);
