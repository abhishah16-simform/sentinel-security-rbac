import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ScopedTransaction } from '../prisma/scoped-prisma';

export type LockedApplication = Prisma.ApplicationGetPayload<{ include: { resourceTypes: true } }>;

/**
 * Locks the Application row until the transaction ends, so changes to one Application (its Schema
 * and its Role Templates) run one at a time: ignore-case uniqueness checks can't be raced, and a
 * Schema entry can't be Deprecated while something is being added that uses it. Returns it with
 * its Resource Types.
 */
export async function lockApplication(tx: ScopedTransaction, applicationId: string): Promise<LockedApplication> {
  await tx.$queryRaw`SELECT id FROM applications WHERE id = ${applicationId}::uuid FOR UPDATE`;
  const application = await tx.application.findUnique({ where: { id: applicationId }, include: { resourceTypes: true } });
  if (!application) throw new NotFoundException('Application not found');
  return application;
}
