import type { Prisma, RoleAssignmentEndReason } from '@prisma/client';
import type { AuditLog } from '../audit/audit-log.service';
import type { ScopedTransaction } from '../prisma/scoped-prisma';

/**
 * Role Assignments that give access at `now`: not revoked, and with no expiry time or one later than
 * now. Every reader that decides access applies this itself, so a Temporary Role Assignment stops
 * counting at exactly its expiry time whether or not anything has marked it.
 */
export function activeAssignmentWhere(now: Date): Prisma.RoleAssignmentWhereInput {
  return { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

/** What the rows to end belong to: one Role (being deleted) or one Membership (being removed). */
export type AssignmentOwner = { readonly roleId: string } | { readonly membershipId: string };

/** The audit payload's name for each reason; the stored enum stays upper-case. */
export const END_REASON_LABELS: Readonly<Record<RoleAssignmentEndReason, string>> = {
  REVOKED: 'revoked',
  ROLE_DELETED: 'role-deleted',
  MEMBERSHIP_ENDED: 'membership-ended',
};

/**
 * Revokes the active Role Assignments of a Role or Membership that is about to be deleted, and records
 * each one in the Tenant's chain. Call it inside the deleting transaction, after locking the Tenant
 * and before the delete, so the rows stay recorded as revoked once the foreign key is set to null.
 * Expired ones are left as they are: they already give no access. Returns how many it revoked.
 */
export async function endRoleAssignments(
  tx: ScopedTransaction,
  audit: AuditLog,
  tenantId: string,
  owner: AssignmentOwner,
  reason: Exclude<RoleAssignmentEndReason, 'REVOKED'>,
  actorUserId: string,
): Promise<number> {
  const now = new Date();
  const ending = await tx.roleAssignment.findMany({
    where: { tenantId, ...owner, ...activeAssignmentWhere(now) },
    include: { role: { select: { name: true } }, application: { select: { name: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (ending.length === 0) return 0;
  await tx.roleAssignment.updateMany({
    where: { id: { in: ending.map((assignment) => assignment.id) } },
    data: { revokedAt: now, revokedByUserId: actorUserId, endReason: reason },
  });
  for (const assignment of ending) {
    await audit.recordIn(tx, {
      tenantId,
      eventType: 'role_assignment.revoked',
      actorUserId,
      target: { type: 'user', id: assignment.userId },
      applicationId: assignment.applicationId,
      payload: {
        roleAssignmentId: assignment.id,
        membershipId: assignment.membershipId,
        role: assignment.role?.name ?? assignment.roleName,
        application: assignment.application.name,
        reason: END_REASON_LABELS[reason],
      },
    });
  }
  return ending.length;
}
