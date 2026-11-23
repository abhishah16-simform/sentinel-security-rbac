import type { ScopedTransaction } from '../prisma/scoped-prisma';

/**
 * Locks the Tenant row until the transaction ends, so a Tenant's Enablement and Role changes run one
 * at a time: two Tenant Admins enabling at once copy the Role Templates only once, and Role names
 * stay unique ignoring case.
 */
export async function lockTenant(tx: ScopedTransaction, tenantId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
}
