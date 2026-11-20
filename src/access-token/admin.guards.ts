import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ScopedPrisma } from '../prisma/scoped-prisma';
import { currentClaimsOf } from './access-token.guard';

/**
 * Requires the caller's Membership in their Active Tenant to be a Tenant Admin, read from the
 * database so a revoked flag takes effect at once. Use after AccessTokenGuard.
 */
@Injectable()
export class TenantAdminGuard implements CanActivate {
  constructor(private readonly scoped: ScopedPrisma) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { tid, mid } = currentClaimsOf(context);
    if (tid === undefined || mid === undefined) throw new ForbiddenException('Choose an Active Tenant first.');
    const membership = await this.scoped.inTenant(tid, (tx) =>
      tx.membership.findUnique({ where: { id: mid }, select: { isTenantAdmin: true } }),
    );
    if (!membership?.isTenantAdmin) throw new ForbiddenException('Only Tenant Admins can do this.');
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
