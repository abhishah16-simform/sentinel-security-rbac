-- CreateEnum
CREATE TYPE "AccessReviewStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AccessReviewOutcome" AS ENUM ('CERTIFIED', 'REVOKED', 'AUTO_REVOKED');

-- AlterEnum
ALTER TYPE "RoleAssignmentEndReason" ADD VALUE 'AUTO_REVOKED';

-- CreateTable
CREATE TABLE "access_reviews" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "status" "AccessReviewStatus" NOT NULL DEFAULT 'OPEN',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "startedByUserId" UUID,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_review_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "roleAssignmentId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "outcome" "AccessReviewOutcome",
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_review_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_reviews_tenantId_createdAt_idx" ON "access_reviews"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "access_reviews_tenantId_status_dueAt_idx" ON "access_reviews"("tenantId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "access_review_items_reviewId_outcome_idx" ON "access_review_items"("reviewId", "outcome");

-- CreateIndex
CREATE INDEX "access_review_items_roleAssignmentId_idx" ON "access_review_items"("roleAssignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "access_review_items_reviewId_roleAssignmentId_key" ON "access_review_items"("reviewId", "roleAssignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "access_review_items_reviewId_position_key" ON "access_review_items"("reviewId", "position");

-- AddForeignKey
ALTER TABLE "access_reviews" ADD CONSTRAINT "access_reviews_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_reviews" ADD CONSTRAINT "access_reviews_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_reviews" ADD CONSTRAINT "access_reviews_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_review_items" ADD CONSTRAINT "access_review_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_review_items" ADD CONSTRAINT "access_review_items_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "access_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_review_items" ADD CONSTRAINT "access_review_items_roleAssignmentId_fkey" FOREIGN KEY ("roleAssignmentId") REFERENCES "role_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_review_items" ADD CONSTRAINT "access_review_items_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Row-Level Security (hand-written; Prisma can't generate it)
-- ---------------------------------------------------------------------------

-- access_reviews and access_review_items are Tenant-owned. FORCE because the app's role owns the
-- tables (ADR 0003).
ALTER TABLE "access_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "access_reviews" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "access_reviews"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

ALTER TABLE "access_review_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "access_review_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "access_review_items"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- At most one open Access Review per Application in a Tenant: two at once would review the same
-- Role Assignments twice.
CREATE UNIQUE INDEX "access_reviews_one_open_per_application"
  ON "access_reviews"("tenantId", "applicationId") WHERE "status" = 'OPEN';

-- A closed review says when it closed, and an open one doesn't.
ALTER TABLE "access_reviews" ADD CONSTRAINT "access_reviews_closed_check"
  CHECK (("status" = 'CLOSED') = ("closedAt" IS NOT NULL));

-- A decided item always says when.
ALTER TABLE "access_review_items" ADD CONSTRAINT "access_review_items_decided_check"
  CHECK (("outcome" IS NULL) = ("decidedAt" IS NULL));