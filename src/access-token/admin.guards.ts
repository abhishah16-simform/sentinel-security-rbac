import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { TENANT_SUSPENDED_MESSAGE } from '../common/tenant-suspended';
import { PrismaService } from '../prisma/prisma.service';
import { ScopedPrisma } from '../prisma/scoped-prisma';
import { currentClaimsOf } from './access-token.guard';

/**
 * Requires the caller's Membership in their Active Tenant to be a Tenant Admin, and the Tenant not to
 * be suspended, both read from the database so a change takes effect at once. Use after AccessTokenGuard.
 */
@Injectable()
export class TenantAdminGuard implements CanActivate {
  constructor(private readonly scoped: ScopedPrisma) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { tid, mid } = currentClaimsOf(context);
    if (tid === undefined || mid === undefined) throw new ForbiddenException('Choose an Active Tenant first.');
    const [membership, tenant] = await this.scoped.inTenant(tid, async (tx) => [
      await tx.membership.findUnique({ where: { id: mid }, select: { isTenantAdmin: true } }),
      await tx.tenant.findUnique({ where: { id: tid }, select: { suspendedAt: true } }),
    ]);
    if (!membership?.isTenantAdmin) throw new ForbiddenException('Only Tenant Admins can do this.');
    // Access tokens outlive a suspension by up to their lifetime; the console freezes at once.
    if (tenant?.suspendedAt) throw new ForbiddenException(TENANT_SUSPENDED_MESSAGE);
    return true;
  }
}

/** Requires the caller to be a Platform Admin, read from the database. Use after AccessTokenGuard. */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { sub } = currentClaimsOf(context);
    const user = await this.prisma.user.findUnique({ where: { id: sub }, select: { isPlatformAdmin: true } });
    if (!user?.isPlatformAdmin) throw new ForbiddenException('Only Platform Admins can do this.');
    return true;
  }
}
