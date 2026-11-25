import type { Prisma } from '@prisma/client';
import type { AuditLog } from '../audit/audit-log.service';
import type { ScopedTransaction } from '../prisma/scoped-prisma';

/** What an item's audit entry names: its review, and its Role Assignment's User, Role and Application. */
export const ITEM_AUDIT_INCLUDE = {
  roleAssignment: {
    select: {
      id: true,
      userId: true,
      membershipId: true,
      applicationId: true,
      roleName: true,
      role: { select: { name: true } },
      application: { select: { name: true } },
    },
  },
} as const satisfies Prisma.AccessReviewItemInclude;

export type AuditedItem = Prisma.AccessReviewItemGetPayload<{ include: typeof ITEM_AUDIT_INCLUDE }>;

/**
 * Writes an access_review.item_* entry in the Tenant's chain, targeting the User so the Audit Log's
 * user filter finds it. actorUserId is null when the Scheduler auto-revokes the item.
 */
export function recordItemEvent(
  tx: ScopedTransaction,
  audit: AuditLog,
  eventType: 'access_review.item_certified' | 'access_review.item_revoked' | 'access_review.item_auto_revoked',
  actorUserId: string | null,
  item: AuditedItem,
): Promise<void> {
  const assignment = item.roleAssignment;
  return audit.recordIn(tx, {
    tenantId: item.tenantId,
    eventType,
    actorUserId,
    target: { type: 'user', id: assignment.userId },
    applicationId: assignment.applicationId,
    payload: {
      accessReviewId: item.reviewId,
      accessReviewItemId: item.id,
      roleAssignmentId: assignment.id,
      membershipId: assignment.membershipId,
      role: assignment.role?.name ?? assignment.roleName,
      application: assignment.application.name,
    },
  });
}

/**
 * Records undecided items for these Role Assignments in open Access Reviews as revoked by the actor,
 * once the assignments themselves have been revoked. Every path that revokes a Role Assignment calls
 * it in the same transaction (after locking the Tenant), so revoking from the Role Assignments page or
 * the per-Registered-Resource view decides the review item as well, and a review never asks about
 * access that is already gone.
 */
export async function resolveReviewItemsAsRevoked(
  tx: ScopedTransaction,
  audit: AuditLog,
  tenantId: string,
  roleAssignmentIds: readonly string[],
  actorUserId: string,
  now: Date,
): Promise<void> {
  if (roleAssignmentIds.length === 0) return;
  const items = await tx.accessReviewItem.findMany({
    where: { tenantId, roleAssignmentId: { in: [...roleAssignmentIds] }, outcome: null, review: { status: 'OPEN' } },
    include: ITEM_AUDIT_INCLUDE,
    orderBy: [{ reviewId: 'asc' }, { position: 'asc' }],
  });
  if (items.length === 0) return;
  await tx.accessReviewItem.updateMany({
    where: { id: { in: items.map((item) => item.id) } },
    data: { outcome: 'REVOKED', decidedAt: now, decidedByUserId: actorUserId },
  });
  for (const item of items) await recordItemEvent(tx, audit, 'access_review.item_revoked', actorUserId, item);
}
