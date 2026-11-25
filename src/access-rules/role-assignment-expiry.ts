import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditLog } from '../audit/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScopedPrisma } from '../prisma/scoped-prisma';
import { recordAssignmentEvent } from './role-assignment-ending';
import { lockTenant } from './tenant-lock';

/** Tenants read per query while walking the Tenant list. */
const TENANT_BATCH = 500;

/** Assignments marked per transaction, so the Tenant and its audit chain are never locked for long. */
const ASSIGNMENT_BATCH = 200;

/** Temporary Role Assignments whose expiry time has passed and that nothing has marked or revoked yet. */
function dueWhere(tenantId: string, now: Date): Prisma.RoleAssignmentWhereInput {
  return { tenantId, revokedAt: null, expiryRecordedAt: null, expiresAt: { lte: now } };
}

/**
 * Marks Temporary Role Assignments whose expiry time has passed as Expired Role Assignments, and
 * records each in its Tenant's Audit Log chain with no actor. Access never waits for this: every
 * reader that decides access already ignores them from their expiry time (activeAssignmentWhere).
 * A marked row is never picked again, so running it twice changes nothing more.
 */
@Injectable()
export class RoleAssignmentExpiry {
  private readonly logger = new Logger(RoleAssignmentExpiry.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scoped: ScopedPrisma,
    private readonly audit: AuditLog,
  ) {}

  /**
   * Every Tenant, one at a time: RLS shows Role Assignments only inside a Tenant context. A Tenant
   * that fails is logged and retried on the next run; the others go ahead. Returns how many it marked.
   */
  async markAllExpired(): Promise<number> {
    let marked = 0;
    let after: string | null = null;
    for (;;) {
      const tenants: readonly { readonly id: string }[] = await this.prisma.tenant.findMany({
        where: after === null ? {} : { id: { gt: after } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: TENANT_BATCH,
      });
      for (const tenant of tenants) {
        try {
          marked += await this.markExpired(tenant.id);
        } catch (error: unknown) {
          this.logger.error(`Could not mark expired Role Assignments in Tenant ${tenant.id}`, error instanceof Error ? error.stack : String(error));
        }
      }
      const last = tenants.at(-1);
      if (tenants.length < TENANT_BATCH || !last) return marked;
      after = last.id;
    }
  }

  /** One Tenant's due assignments, a batch per transaction. Returns how many it marked. */
  async markExpired(tenantId: string): Promise<number> {
    let marked = 0;
    for (;;) {
      const batch = await this.markBatch(tenantId);
      marked += batch;
      if (batch < ASSIGNMENT_BATCH) return marked;
    }
  }

  private markBatch(tenantId: string): Promise<number> {
    return this.scoped.inTenant(tenantId, async (tx) => {
      // Most runs find nothing; only lock the Tenant when there is work to do.
      if (!(await tx.roleAssignment.findFirst({ where: dueWhere(tenantId, new Date()), select: { id: true } }))) return 0;
      // The same lock as revoking, deleting a Role and removing a Membership, so none of them races
      // this, and a second run waiting here finds the rows already marked.
      await lockTenant(tx, tenantId);
      const now = new Date();
      const due = await tx.roleAssignment.findMany({
        where: dueWhere(tenantId, now),
        include: { role: { select: { name: true } }, application: { select: { name: true } } },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        take: ASSIGNMENT_BATCH,
      });
      if (due.length === 0) return 0;
      await tx.roleAssignment.updateMany({
        where: { id: { in: due.map((assignment) => assignment.id) } },
        data: { expiryRecordedAt: now },
      });
      for (const assignment of due) {
        await recordAssignmentEvent(
          tx,
          this.audit,
          'role_assignment.expired',
          null,
          { ...assignment, roleName: assignment.role?.name ?? assignment.roleName, applicationName: assignment.application.name },
          { expiresAt: assignment.expiresAt?.toISOString() ?? null },
        );
      }
      return due.length;
    });
  }
}
