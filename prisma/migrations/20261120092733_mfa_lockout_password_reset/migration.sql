-- CreateEnum
CREATE TYPE "EmailChallengePurpose" AS ENUM ('MFA_LOGIN', 'MFA_DISABLE', 'PASSWORD_RESET');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "mfaEnabledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "email_challenges" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "EmailChallengePurpose" NOT NULL,
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "codeHash" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "codeAttempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_failures" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_failures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_challenges_tokenHash_key" ON "email_challenges"("tokenHash");

-- CreateIndex
CREATE INDEX "email_challenges_userId_purpose_idx" ON "email_challenges"("userId", "purpose");

-- CreateIndex
CREATE INDEX "auth_failures_userId_createdAt_idx" ON "auth_failures"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "email_challenges" ADD CONSTRAINT "email_challenges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_failures" ADD CONSTRAINT "auth_failures_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
