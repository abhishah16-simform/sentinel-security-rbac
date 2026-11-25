import type { Prisma, RoleAssignmentEndReason } from '@prisma/client';
import type { AuditEventType } from '../audit/audit-event-types';
import type { AuditLog, AuditPayload } from '../audit/audit-log.service';
import type { ScopedTransaction } from '../prisma/scoped-prisma';

/**
 * Role Assignments that give access at `now`: not revoked, and with no expiry time or one later than
 * now. Every reader that decides access applies this itself, so a Temporary Role Assignment stops
 * counting at exactly its expiry time whether or not anything has marked it. A row whose Membership or
 * Role is gone never counts either, even if a delete skipped endRoleAssignments().
 */
export function activeAssignmentWhere(now: Date): Prisma.RoleAssignmentWhereInput {
  // Everything under one AND key, so spreading this next to a caller's own membershipId or roleId
  // filter adds to it instead of replacing it.
  return {
    AND: [
      { revokedAt: null },
      { membershipId: { not: null } },
      { roleId: { not: null } },
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    ],
  };
}

/** What the rows to end belong to: one Role (being deleted) or one Membership (being removed). */
export type AssignmentOwner = { readonly roleId: string } | { readonly membershipId: string };

/** The API's and audit payload's name for each reason; the stored enum stays upper-case. */
export const END_REASON_LABELS = {
  REVOKED: 'revoked',
  ROLE_DELETED: 'role-deleted',
  MEMBERSHIP_ENDED: 'membership-ended',
} as const satisfies Record<RoleAssignmentEndReason, string>;

export type EndReasonLabel = (typeof END_REASON_LABELS)[RoleAssignmentEndReason];

/** The columns that revoke a Role Assignment. */
export function revocationData(
  now: Date,
  actorUserId: string,
  reason: RoleAssignmentEndReason,
): Prisma.RoleAssignmentUncheckedUpdateManyInput {
  return { revokedAt: now, revokedByUserId: actorUserId, endReason: reason };
}

/** An assignment as its audit entries describe it, with its Role's and Application's names. */
export interface AuditedAssignment {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly membershipId: string | null;
  readonly applicationId: string;
  readonly roleName: string;
  readonly applicationName: string;
}

/**
 * Writes a role_assignment.* entry in the Tenant's chain, targeting the User so the Audit Log's user
 * filter finds it. actorUserId is null when Sentinel itself made the change (the Scheduler).
 */
export function recordAssignmentEvent(
  tx: ScopedTransaction,
  audit: AuditLog,
  eventType: Extract<AuditEventType, `role_assignment.${string}`>,
  actorUserId: string | null,
  assignment: AuditedAssignment,
  payload: AuditPayload,
): Promise<void> {
  return audit.recordIn(tx, {
    tenantId: assignment.tenantId,
    eventType,
    actorUserId,
    target: { type: 'user', id: assignment.userId },
    applicationId: assignment.applicationId,
    payload: {
      roleAssignmentId: assignment.id,
      membershipId: assignment.membershipId,
      role: assignment.roleName,
      application: assignment.applicationName,
      ...payload,
    },
  });
}

/**
 * Revokes the active Role Assignments of a Role or Membership that is about to be deleted, and records
 * each one in the Tenant's chain. Every path that deletes a Role or Membership (including erasure)
 * must call it inside the deleting transaction, after locking the Tenant and before the delete, so the
 * rows stay recorded as revoked once the foreign key is set to null. Expired ones are left as they
 * are: they already give no access. Returns how many it revoked.
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
    data: revocationData(now, actorUserId, reason),
  });
  for (const assignment of ending) {
    await recordAssignmentEvent(
      tx,
      audit,
      'role_assignment.revoked',
      actorUserId,
      { ...assignment, roleName: assignment.role?.name ?? assignment.roleName, applicationName: assignment.application.name },
      { reason: END_REASON_LABELS[reason] },
    );
  }
  return ending.length;
}
