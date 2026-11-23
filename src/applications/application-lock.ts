import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ScopedTransaction } from '../prisma/scoped-prisma';

export type LockedApplication = Prisma.ApplicationGetPayload<{ include: { resourceTypes: true } }>;

/**
 * Locks the Application row until the transaction ends. Changes to one Application (its Schema and
 * its Role Templates) take it 'update', so they run one at a time: ignore-case uniqueness checks
 * can't be raced, and a Schema entry can't be Deprecated while something that uses it is added.
 * Readers that need the Schema and templates to hold still (copying templates into a Tenant) take
 * it 'share'. Returns it with its Resource Types.
 */
export async function lockApplication(
  tx: ScopedTransaction,
  applicationId: string,
  mode: 'update' | 'share' = 'update',
): Promise<LockedApplication> {
  if (mode === 'update') await tx.$queryRaw`SELECT id FROM applications WHERE id = ${applicationId}::uuid FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM applications WHERE id = ${applicationId}::uuid FOR SHARE`;
  const application = await tx.application.findUnique({ where: { id: applicationId }, include: { resourceTypes: true } });
  if (!application) throw new NotFoundException('Application not found');
  return application;
}
