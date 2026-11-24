import type { Prisma } from '@prisma/client';

/** The error message for anything refused because a Platform Admin suspended the Tenant. */
export const TENANT_SUSPENDED_MESSAGE = 'This Tenant is suspended. Contact SENTINEL support.';

/**
 * Whether a Platform Admin has suspended the Tenant. The Tenant list is platform-level (no RLS), so
 * this works in any context. With lock, it takes the row FOR SHARE until the transaction ends, so a
 * suspension (which locks it FOR UPDATE) can't commit between this read and what the caller issues.
 */
export async function isTenantSuspended(
  tx: Prisma.TransactionClient,
  tenantId: string,
  { lock = false }: { readonly lock?: boolean } = {},
): Promise<boolean> {
  if (lock) await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR SHARE`;
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { suspendedAt: true } });
  return tenant !== null && tenant.suspendedAt !== null;
}
