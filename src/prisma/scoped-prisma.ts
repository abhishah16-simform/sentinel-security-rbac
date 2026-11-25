import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

export type ScopedTransaction = Prisma.TransactionClient;

/**
 * Sets the Tenant whose rows RLS lets this transaction see ('' for none). Must run before any other
 * query in it; the one exception is AuditLog, which switches to the entry's chain for its insert and
 * the Security Alert rules (which may raise alerts in other Tenants), then restores the caller's context.
 */
export async function setTenantContext(tx: ScopedTransaction, tenantId: string): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
}

/** Sets the User whose own rows user-scoped policies let this transaction see ('' for none). */
export async function setUserContext(tx: ScopedTransaction, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
}

/**
 * Runs database work under a Row-Level Security context. Each call is one transaction whose
 * first statement sets the context with set_config(..., true), the function form of SET LOCAL,
 * so the setting ends with the transaction and never leaks to another request on the same
 * pooled connection.
 */
@Injectable()
export class ScopedPrisma {
  constructor(private readonly prisma: PrismaService) {}

  /** Work inside one Tenant: Tenant-owned tables show only that Tenant's rows. */
  inTenant<T>(tenantId: string, work: (tx: ScopedTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, tenantId);
      return work(tx);
    });
  }

  /**
   * Work for one User across Tenants, with no Tenant context. Only policies written for it apply,
   * such as reading the User's own Memberships for the Tenant picker.
   */
  asUser<T>(userId: string, work: (tx: ScopedTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setUserContext(tx, userId);
      return work(tx);
    });
  }
}
