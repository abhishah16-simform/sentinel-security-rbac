import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Membership, Tenant } from '@prisma/client';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScopedPrisma, setTenantContext } from '../prisma/scoped-prisma';

/** A User's Membership together with the Tenant it belongs to. */
export interface TenantMembership {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly membershipId: string;
  readonly isTenantAdmin: boolean;
}

/** Identifies the Membership a request acts through, as carried in the access token. */
export interface ActiveTenantRef {
  readonly tenantId: string;
  readonly membershipId: string;
}

function toTenantMembership(membership: Membership & { tenant: Tenant }): TenantMembership {
  return {
    tenantId: membership.tenantId,
    tenantName: membership.tenant.name,
    membershipId: membership.id,
    isTenantAdmin: membership.isTenantAdmin,
  };
}

/** Tenants and Memberships. */
@Injectable()
export class TenancyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoped: ScopedPrisma,
    private readonly identity: IdentityService,
  ) {}

  /** Creates a Tenant and makes the creator its first Tenant Admin. Only verified Users may. */
  async createTenant(userId: string, name: string): Promise<TenantMembership> {
    const user = await this.identity.getProfile(userId);
    if (!user.emailVerified) {
      throw new ForbiddenException('Verify your email address before creating a Tenant.');
    }
    if (user.isPlatformAdmin) {
      throw new ForbiddenException('Platform Admin accounts have no Memberships, so they cannot create Tenants.');
    }

    // One transaction: the Tenant list has no RLS, then the Membership is written inside the new
    // Tenant's context so the memberships policy's WITH CHECK accepts it.
    const membership = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name } });
      await setTenantContext(tx, tenant.id);
      return tx.membership.create({
        data: { tenantId: tenant.id, userId, isTenantAdmin: true },
        include: { tenant: true },
      });
    });
    return toTenantMembership(membership);
  }

  /** Every Tenant the User belongs to, for the Tenant picker. */
  async listForUser(userId: string): Promise<TenantMembership[]> {
    const memberships = await this.scoped.asUser(userId, (tx) =>
      tx.membership.findMany({ where: { userId }, include: { tenant: true }, orderBy: { createdAt: 'asc' } }),
    );
    return memberships.map(toTenantMembership);
  }

  /** The User's Membership in a Tenant, or null if they don't belong to it. */
  async findMembership(userId: string, tenantId: string): Promise<TenantMembership | null> {
    const membership = await this.scoped.asUser(userId, (tx) =>
      tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } }, include: { tenant: true } }),
    );
    return membership ? toTenantMembership(membership) : null;
  }

  /** The Active Tenant and Membership, read inside that Tenant's context. */
  async getActive(active: ActiveTenantRef): Promise<TenantMembership> {
    const membership = await this.scoped.inTenant(active.tenantId, (tx) =>
      tx.membership.findUnique({ where: { id: active.membershipId }, include: { tenant: true } }),
    );
    if (!membership) throw new NotFoundException('Your Membership in the Active Tenant no longer exists.');
    return toTenantMembership(membership);
  }
}
