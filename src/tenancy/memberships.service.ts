import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Membership } from '@prisma/client';
import type { AuditEventType } from '../audit/audit-event-types';
import { AuditLog } from '../audit/audit-log.service';
import { ScopedPrisma, type ScopedTransaction } from '../prisma/scoped-prisma';
import type { ActiveTenantRef } from './tenancy.service';

/** One Membership in the Tenant Admin's Memberships list. */
export interface TenantMember {
  readonly membershipId: string;
  readonly userId: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly isTenantAdmin: boolean;
  readonly joinedAt: Date;
}

const LAST_ADMIN_MESSAGE = 'A Tenant must keep at least one Tenant Admin. Make someone else a Tenant Admin first.';

/**
 * Locks the Tenant row until the transaction ends, so changes to its Memberships run one at a time
 * and two Tenant Admins can't each remove the other's flag at once.
 */
export async function lockTenant(tx: ScopedTransaction, tenantId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
}

/** Refuses a change that would take away the Tenant's last Tenant Admin. Call after lockTenant. */
async function assertAnotherAdmin(tx: ScopedTransaction, membership: Membership): Promise<void> {
  if (!membership.isTenantAdmin) return;
  const others = await tx.membership.count({
    where: { tenantId: membership.tenantId, isTenantAdmin: true, id: { not: membership.id } },
  });
  if (others === 0) throw new ConflictException(LAST_ADMIN_MESSAGE);
}

/** Listing and changing the Memberships of a Tenant, and leaving one. */
@Injectable()
export class MembershipsService {
  constructor(
    private readonly scoped: ScopedPrisma,
    private readonly audit: AuditLog,
  ) {}

  async list(tenantId: string): Promise<TenantMember[]> {
    const memberships = await this.scoped.inTenant(tenantId, (tx) =>
      tx.membership.findMany({ where: { tenantId }, include: { user: true }, orderBy: { createdAt: 'asc' } }),
    );
    return memberships.map((membership) => ({
      membershipId: membership.id,
      userId: membership.userId,
      email: membership.user.email,
      firstName: membership.user.firstName,
      lastName: membership.user.lastName,
      isTenantAdmin: membership.isTenantAdmin,
      joinedAt: membership.createdAt,
    }));
  }

  /** A Tenant Admin removes a Membership from the Active Tenant. */
  async remove(active: ActiveTenantRef, actorUserId: string, membershipId: string): Promise<void> {
    await this.scoped.inTenant(active.tenantId, async (tx) => {
      await lockTenant(tx, active.tenantId);
      const membership = await this.findIn(tx, active.tenantId, membershipId);
      await assertAnotherAdmin(tx, membership);
      await tx.membership.delete({ where: { id: membership.id } });
      await this.recordIn(tx, membership, 'membership.removed', actorUserId);
    });
  }

  /** A Tenant Admin gives or removes the Tenant Admin flag. Setting it to what it is already does nothing. */
  async setTenantAdmin(
    active: ActiveTenantRef,
    actorUserId: string,
    membershipId: string,
    isTenantAdmin: boolean,
  ): Promise<TenantMember> {
    await this.scoped.inTenant(active.tenantId, async (tx) => {
      await lockTenant(tx, active.tenantId);
      const membership = await this.findIn(tx, active.tenantId, membershipId);
      if (membership.isTenantAdmin === isTenantAdmin) return;
      if (!isTenantAdmin) await assertAnotherAdmin(tx, membership);
      await tx.membership.update({ where: { id: membership.id }, data: { isTenantAdmin } });
      await this.recordIn(tx, membership, isTenantAdmin ? 'membership.admin_granted' : 'membership.admin_revoked', actorUserId);
    });
    const member = (await this.list(active.tenantId)).find((item) => item.membershipId === membershipId);
    if (!member) throw new NotFoundException('Membership not found');
    return member;
  }

  /** A User leaves a Tenant themselves. The last Tenant Admin can't. */
  async leave(userId: string, tenantId: string): Promise<void> {
    await this.scoped.inTenant(tenantId, async (tx) => {
      await lockTenant(tx, tenantId);
      const membership = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
      if (!membership) throw new NotFoundException('You are not a member of that Tenant.');
      await assertAnotherAdmin(tx, membership);
      await tx.membership.delete({ where: { id: membership.id } });
      await this.recordIn(tx, membership, 'membership.left', userId);
    });
  }

  private async findIn(tx: ScopedTransaction, tenantId: string, membershipId: string): Promise<Membership> {
    const membership = await tx.membership.findFirst({ where: { id: membershipId, tenantId } });
    if (!membership) throw new NotFoundException('Membership not found');
    return membership;
  }

  private recordIn(tx: ScopedTransaction, membership: Membership, eventType: AuditEventType, actorUserId: string): Promise<void> {
    return this.audit.recordIn(tx, {
      tenantId: membership.tenantId,
      eventType,
      actorUserId,
      target: { type: 'user', id: membership.userId },
      payload: { membershipId: membership.id },
    });
  }
}
