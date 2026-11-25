-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "activeTenantId" UUID;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_activeTenantId_fkey" FOREIGN KEY ("activeTenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
