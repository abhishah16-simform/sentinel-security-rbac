-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "invitedByUserId" UUID,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "membershipId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_tenantId_status_idx" ON "invitations"("tenantId", "status");

-- CreateIndex
CREATE INDEX "invitations_email_status_idx" ON "invitations"("email", "status");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most one pending Invitation per email in a Tenant. Closed ones are kept as history.
CREATE UNIQUE INDEX "invitations_pending_tenantId_email_key" ON "invitations"("tenantId", "email") WHERE "status" = 'PENDING';

-- ---------------------------------------------------------------------------
-- Row-Level Security (hand-written; Prisma can't generate it)
-- ---------------------------------------------------------------------------

-- invitations is Tenant-owned. FORCE because the app's role owns the table (ADR 0003).
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;

-- Reads and writes inside the Active Tenant.
CREATE POLICY tenant_isolation ON "invitations"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- A User may read Invitations sent to their own email in every Tenant (the Invitations inbox).
-- Read-only: accepting or declining switches to the Invitation's Tenant context to write.
CREATE POLICY own_invitations ON "invitations"
  FOR SELECT
  USING ("email" = (SELECT u."email" FROM "users" u WHERE u."id" = app_current_user_id()));
