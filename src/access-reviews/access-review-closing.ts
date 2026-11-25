import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { recordItemEvent } from '../access-rules/review-item-resolution';
import { revokeIfActive } from '../access-rules/role-assignment-ending';
import { lockTenant } from '../access-rules/tenant-lock';
import { AuditLog } from '../audit/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScopedPrisma } from '../prisma/scoped-prisma';
import { reviewProgress } from './access-reviews.service';

/** Tenants read per query while walking the Tenant list. */
const TENANT_BATCH = 500;

/**
 * Items auto-revoked per transaction. Each is one or two chained audit writes, so this keeps the
 * transaction well inside Prisma's interactive-transaction timeout and the Tenant locked only briefly.
 */
const ITEM_BATCH = 50;

/**
 * Closes Access Reviews whose due date has passed: every item still undecided is auto-revoked (its
 * Role Assignment revoked if it still gives access) and the review is closed, all recorded in the
 * Tenant's chain with no actor. Decisions stop at the due date whether or not this has run, and an
 * interrupted run carries on where it stopped, so a repeated or concurrent run changes nothing more.
 */
@Injectable()
export class AccessReviewClosing {
  private readonly logger = new Logger(AccessReviewClosing.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scoped: ScopedPrisma,
    private readonly audit: AuditLog,
  ) {}

  /**
   * Every Tenant, one at a time: RLS shows Access Reviews only inside a Tenant context. A Tenant that
   * fails is logged and retried on the next run; the others go ahead. Returns how many it closed.
   */
  async closeAllDue(): Promise<number> {
    let closed = 0;
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
          closed += await this.closeDue(tenant.id);
        } catch (error: unknown) {
          this.logger.error(`Could not close due Access Reviews in Tenant ${tenant.id}`, error instanceof Error ? error.stack : String(error));
        }
      }
      const last = tenants.at(-1);
      if (tenants.length < TENANT_BATCH || !last) return closed;
      after = last.id;
    }
  }

  /** One Tenant's due reviews, a batch of items per transaction. Returns how many it closed. */
  private async closeDue(tenantId: string): Promise<number> {
    let closed = 0;
    for (;;) {
      const result = await this.closeNextBatch(tenantId);
      if (result === 'nothing-due') return closed;
      if (result === 'closed') closed += 1;
    }
  }

  /**
   * Auto-revokes one batch of the oldest due review's undecided items ('batch-revoked'), or closes it
   * once none are left ('closed'). 'nothing-due' when no open review in the Tenant is past its due date.
   */
  private closeNextBatch(tenantId: string): Promise<'nothing-due' | 'batch-revoked' | 'closed'> {
    return this.scoped.inTenant(tenantId, async (tx) => {
      const dueWhere = (now: Date): Prisma.AccessReviewWhereInput => ({ tenantId, status: 'OPEN', dueAt: { lte: now } });
      // Most runs find nothing; only lock the Tenant when there is work to do.
      if (!(await tx.accessReview.findFirst({ where: dueWhere(new Date()), select: { id: true } }))) return 'nothing-due';
      // The same lock as every decision and revoke, so none of them races this, and a second run
      // waiting here finds the items already decided.
      await lockTenant(tx, tenantId);
      const now = new Date();
      const review = await tx.accessReview.findFirst({
        where: dueWhere(now),
        include: { application: { select: { name: true } } },
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      });
      if (!review) return 'nothing-due';
      const pending = await tx.accessReviewItem.findMany({
        where: { tenantId, reviewId: review.id, outcome: null },
        include: { roleAssignment: { include: { role: { select: { name: true } }, application: { select: { name: true } } } } },
        orderBy: { position: 'asc' },
        take: ITEM_BATCH,
      });
      // An expired or already revoked one gives no access; it is recorded as auto-revoked all the same.
      for (const item of pending) {
        await revokeIfActive(tx, this.audit, item.roleAssignment, now, null, 'AUTO_REVOKED', { accessReviewId: review.id });
      }
      if (pending.length > 0) {
        await tx.accessReviewItem.updateMany({
          where: { id: { in: pending.map((item) => item.id) } },
          data: { outcome: 'AUTO_REVOKED', decidedAt: now, decidedByUserId: null },
        });
        for (const item of pending) await recordItemEvent(tx, this.audit, 'access_review.item_auto_revoked', null, item);
      }
      if (pending.length === ITEM_BATCH) return 'batch-revoked';

      await tx.accessReview.update({ where: { id: review.id }, data: { status: 'CLOSED', closedAt: now } });
      const progress = (await reviewProgress(tx, tenantId, [review.id])).get(review.id);
      await this.audit.recordIn(tx, {
        tenantId,
        eventType: 'access_review.closed',
        actorUserId: null,
        target: { type: 'access_review', id: review.id },
        applicationId: review.applicationId,
        payload: {
          accessReviewId: review.id,
          application: review.application.name,
          dueAt: review.dueAt.toISOString(),
          certified: progress?.certified ?? 0,
          revoked: progress?.revoked ?? 0,
          autoRevoked: progress?.autoRevoked ?? 0,
        },
      });
      return 'closed';
    });
  }
}
