import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { loadSchemaIndexes, SchemaIndex } from '../applications/schema-index';
import type { AuditEventType } from '../audit/audit-event-types';
import { AuditLog, type AuditPayload } from '../audit/audit-log.service';
import { type Page, pageWindow, toPage } from '../common/pagination';
import { ScopedPrisma, type ScopedTransaction } from '../prisma/scoped-prisma';
import type { RoleAssignmentListQuery, RoleAssignmentStatus } from './dto/role-assignment.dto';
import { activeAssignmentWhere, END_REASON_LABELS } from './role-assignment-ending';
import { ROLE_WITH_PERMISSIONS, type PermissionView, toRoleView } from './role-view';
import { lockTenant } from './tenant-lock';

/** Active Role Assignments one Membership may hold at once. */
export const MAX_ACTIVE_ASSIGNMENTS_PER_MEMBERSHIP = 200;

/** How far ahead an expiry time may be. */
const MAX_EXPIRY_YEARS = 10;

/** The person a Role Assignment is for. membershipId is null once the Membership has ended. */
export interface AssignedMember {
  readonly membershipId: string | null;
  readonly userId: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
}

export interface RoleAssignmentView {
  readonly id: string;
  /** active gives access now; expired and revoked never do again. */
  readonly status: RoleAssignmentStatus;
  readonly member: AssignedMember;
  /** id is null once the Role is deleted; name is then its last name. */
  readonly role: { readonly id: string | null; readonly name: string };
  readonly application: { readonly id: string; readonly name: string; readonly enabled: boolean };
  readonly expiresAt: Date | null;
  readonly assignedByName: string | null;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
  readonly revokedByName: string | null;
  /** Why it was revoked: revoked (by a Tenant Admin), role-deleted or membership-ended. */
  readonly endReason: string | null;
}

/** One Permission a Membership holds through one of its active Role Assignments. */
export interface EffectivePermission extends PermissionView {
  readonly role: { readonly id: string; readonly name: string };
  readonly roleAssignmentId: string;
  /** When the assignment giving it expires; null if permanent. */
  readonly expiresAt: Date | null;
  /**
   * An allow that an unconditional deny of the same Action on the same Resource Type (from any of the
   * Membership's Roles in this Application) always overrides. Conditional denies may override it too,
   * depending on the resource.
   */
  readonly overriddenByDeny: boolean;
}

export interface EffectiveApplication {
  readonly id: string;
  readonly name: string;
  /** A disabled Application's Roles give no access until it is enabled again. */
  readonly enabled: boolean;
  readonly permissions: readonly EffectivePermission[];
}

/** What a Membership can do now, across every Role it actively holds. */
export interface EffectivePermissions {
  readonly member: AssignedMember;
  readonly isTenantAdmin: boolean;
  /** The moment the answer was worked out: Temporary Role Assignments count only until they expire. */
  readonly asOf: Date;
  readonly assignments: readonly RoleAssignmentView[];
  readonly applications: readonly EffectiveApplication[];
}

export interface CreateRoleAssignmentInput {
  readonly membershipId: string;
  readonly roleId: string;
  readonly expiresAt?: string | null;
}

const USER_NAME = { select: { email: true, firstName: true, lastName: true } } as const;

const ASSIGNMENT_INCLUDE = {
  user: USER_NAME,
  role: { select: { id: true, name: true } },
  application: { select: { id: true, name: true } },
  assignedBy: USER_NAME,
  revokedBy: USER_NAME,
} as const satisfies Prisma.RoleAssignmentInclude;

type AssignmentRow = Prisma.RoleAssignmentGetPayload<{ include: typeof ASSIGNMENT_INCLUDE }>;

interface UserName {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
}

function displayName(user: UserName | null): string | null {
  if (!user) return null;
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
}

function statusOf(row: { readonly revokedAt: Date | null; readonly expiresAt: Date | null }, now: Date): RoleAssignmentStatus {
  if (row.revokedAt !== null) return 'revoked';
  return row.expiresAt !== null && row.expiresAt <= now ? 'expired' : 'active';
}

function statusWhere(status: RoleAssignmentStatus | undefined, now: Date): Prisma.RoleAssignmentWhereInput {
  switch (status) {
    case 'active':
      return activeAssignmentWhere(now);
    case 'expired':
      return { revokedAt: null, expiresAt: { lte: now } };
    case 'revoked':
      return { revokedAt: { not: null } };
    default:
      return {};
  }
}

function toView(row: AssignmentRow, enabled: ReadonlySet<string>, now: Date): RoleAssignmentView {
  return {
    id: row.id,
    status: statusOf(row, now),
    member: {
      membershipId: row.membershipId,
      userId: row.userId,
      email: row.user.email,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
    },
    role: { id: row.role?.id ?? null, name: row.role?.name ?? row.roleName },
    application: { id: row.application.id, name: row.application.name, enabled: enabled.has(row.applicationId) },
    expiresAt: row.expiresAt,
    assignedByName: displayName(row.assignedBy),
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
    revokedByName: displayName(row.revokedBy),
    endReason: row.endReason === null ? null : END_REASON_LABELS[row.endReason],
  };
}

/** Parses an optional expiry time; it must be in the future and at most MAX_EXPIRY_YEARS ahead. */
function parseExpiry(value: string | null | undefined, now: Date): Date | null {
  if (value === undefined || value === null) return null;
  const expiresAt = new Date(value);
  if (Number.isNaN(expiresAt.getTime())) throw new BadRequestException('expiresAt is not a valid time');
  if (expiresAt <= now) throw new BadRequestException('expiresAt must be in the future');
  const latest = new Date(now);
  latest.setUTCFullYear(latest.getUTCFullYear() + MAX_EXPIRY_YEARS);
  if (expiresAt > latest) throw new BadRequestException(`expiresAt must be within ${MAX_EXPIRY_YEARS} years`);
  return expiresAt;
}

/**
 * Role Assignments inside the Active Tenant, for its Tenant Admins: giving a Role to a Membership
 * across the whole Tenant, optionally until an expiry time, revoking it, and a Membership's
 * effective Permissions. Assignments are never deleted. Every change locks the Tenant row, so it
 * can't race Role deletion, Membership removal or Enablement changes.
 */
@Injectable()
export class RoleAssignmentsService {
  constructor(
    private readonly scoped: ScopedPrisma,
    private readonly audit: AuditLog,
  ) {}

  /** Newest first, optionally for one Membership, Role or Application, or in one status. */
  async list(tenantId: string, query: RoleAssignmentListQuery): Promise<Page<RoleAssignmentView>> {
    const window = pageWindow(query, 'desc');
    const now = new Date();
    return this.scoped.inTenant(tenantId, async (tx) => {
      const rows = await tx.roleAssignment.findMany({
        where: {
          AND: [
            {
              tenantId,
              ...(query.membershipId ? { membershipId: query.membershipId } : {}),
              ...(query.roleId ? { roleId: query.roleId } : {}),
              ...(query.applicationId ? { applicationId: query.applicationId } : {}),
              ...window.after,
            },
            statusWhere(query.status, now),
          ],
        },
        include: ASSIGNMENT_INCLUDE,
        orderBy: window.orderBy,
        take: window.take,
      });
      const enabled = await enabledApplications(tx, tenantId, rows.map((row) => row.applicationId));
      return toPage(rows, window, (row) => toView(row, enabled, now));
    });
  }

  async get(tenantId: string, assignmentId: string): Promise<RoleAssignmentView> {
    return this.scoped.inTenant(tenantId, (tx) => this.viewIn(tx, tenantId, assignmentId));
  }

  /**
   * Gives a Role to a Membership. The Role's Application must be enabled, and the Membership may not
   * already hold the Role actively (revoke it first to change its expiry time).
   */
  async create(tenantId: string, actorUserId: string, input: CreateRoleAssignmentInput): Promise<RoleAssignmentView> {
    const now = new Date();
    const expiresAt = parseExpiry(input.expiresAt, now);
    return this.scoped.inTenant(tenantId, async (tx) => {
      await lockTenant(tx, tenantId);
      const membership = await tx.membership.findFirst({ where: { id: input.membershipId, tenantId }, include: { user: USER_NAME } });
      if (!membership) throw new NotFoundException('Membership not found');
      const role = await tx.role.findFirst({ where: { id: input.roleId, tenantId }, include: { application: true } });
      if (!role) throw new NotFoundException('Role not found');
      const enablement = await tx.enablement.findUnique({
        where: { tenantId_applicationId: { tenantId, applicationId: role.applicationId } },
      });
      if (!enablement || enablement.disabledAt !== null) {
        throw new ConflictException(`Enable ${role.application.name} before assigning its Roles`);
      }
      const active = await tx.roleAssignment.findMany({
        where: { tenantId, membershipId: membership.id, ...activeAssignmentWhere(now) },
        select: { roleId: true },
      });
      const who = displayName(membership.user) ?? membership.user.email;
      if (active.some((assignment) => assignment.roleId === role.id)) {
        throw new ConflictException(`${who} already has the Role "${role.name}". Revoke it first to change its expiry time.`);
      }
      if (active.length >= MAX_ACTIVE_ASSIGNMENTS_PER_MEMBERSHIP) {
        throw new ConflictException(`A Membership can hold at most ${MAX_ACTIVE_ASSIGNMENTS_PER_MEMBERSHIP} active Role Assignments`);
      }
      const created = await tx.roleAssignment.create({
        data: {
          tenantId,
          membershipId: membership.id,
          userId: membership.userId,
          roleId: role.id,
          applicationId: role.applicationId,
          roleName: role.name,
          expiresAt,
          assignedByUserId: actorUserId,
        },
      });
      await this.recordIn(tx, 'role_assignment.created', actorUserId, created, role.name, role.application.name, {
        expiresAt: expiresAt === null ? null : expiresAt.toISOString(),
      });
      return this.viewIn(tx, tenantId, created.id);
    });
  }

  /** Ends an active Role Assignment at once. The row stays, marked revoked. */
  async revoke(tenantId: string, actorUserId: string, assignmentId: string): Promise<RoleAssignmentView> {
    return this.scoped.inTenant(tenantId, async (tx) => {
      await lockTenant(tx, tenantId);
      const now = new Date();
      const row = await this.findIn(tx, tenantId, assignmentId);
      const status = statusOf(row, now);
      if (status === 'revoked') throw new ConflictException('This Role Assignment is already revoked');
      if (status === 'expired') throw new ConflictException('This Role Assignment has already expired and gives no access');
      await tx.roleAssignment.update({
        where: { id: row.id },
        data: { revokedAt: now, revokedByUserId: actorUserId, endReason: 'REVOKED' },
      });
      await this.recordIn(tx, 'role_assignment.revoked', actorUserId, row, row.role?.name ?? row.roleName, row.application.name, {
        reason: END_REASON_LABELS.REVOKED,
      });
      return this.viewIn(tx, tenantId, row.id);
    });
  }

  /** Every Permission the Membership holds now through its active Role Assignments, by Application. */
  async effectivePermissions(tenantId: string, membershipId: string): Promise<EffectivePermissions> {
    const now = new Date();
    return this.scoped.inTenant(tenantId, async (tx) => {
      const membership = await tx.membership.findFirst({ where: { id: membershipId, tenantId }, include: { user: USER_NAME } });
      if (!membership) throw new NotFoundException('Membership not found');
      const rows = await tx.roleAssignment.findMany({
        where: { tenantId, membershipId, ...activeAssignmentWhere(now) },
        include: { ...ASSIGNMENT_INCLUDE, role: { include: ROLE_WITH_PERMISSIONS } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const applicationIds = [...new Set(rows.map((row) => row.applicationId))];
      const enabled = await enabledApplications(tx, tenantId, applicationIds);
      const schemas = await loadSchemaIndexes(tx, applicationIds);

      const byApplication = new Map<string, { name: string; permissions: Omit<EffectivePermission, 'overriddenByDeny'>[] }>();
      for (const row of rows) {
        // An active assignment always has its Role: deleting a Role revokes its assignments first.
        if (!row.role) continue;
        const entry = byApplication.get(row.applicationId) ?? { name: row.application.name, permissions: [] };
        byApplication.set(row.applicationId, entry);
        const view = toRoleView(row.role, schemas.get(row.applicationId) ?? new SchemaIndex([]));
        for (const permission of view.permissions) {
          entry.permissions.push({
            ...permission,
            role: { id: row.role.id, name: row.role.name },
            roleAssignmentId: row.id,
            expiresAt: row.expiresAt,
          });
        }
      }

      const applications = [...byApplication.entries()]
        .map(([id, entry]): EffectiveApplication => {
          const hardDenies = new Set(
            entry.permissions
              .filter((permission) => permission.inverted && permission.conditions === null)
              .map((permission) => `${permission.resourceType}\u0000${permission.action}`),
          );
          const permissions = entry.permissions
            .map((permission) => ({
              ...permission,
              overriddenByDeny: !permission.inverted && hardDenies.has(`${permission.resourceType}\u0000${permission.action}`),
            }))
            .sort(
              (a, b) =>
                a.resourceType.localeCompare(b.resourceType) ||
                a.action.localeCompare(b.action) ||
                Number(a.inverted) - Number(b.inverted) ||
                a.role.name.localeCompare(b.role.name),
            );
          return { id, name: entry.name, enabled: enabled.has(id), permissions };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      return {
        member: {
          membershipId: membership.id,
          userId: membership.userId,
          email: membership.user.email,
          firstName: membership.user.firstName,
          lastName: membership.user.lastName,
        },
        isTenantAdmin: membership.isTenantAdmin,
        asOf: now,
        assignments: rows.map((row) => toView({ ...row, role: row.role && { id: row.role.id, name: row.role.name } }, enabled, now)),
        applications,
      };
    });
  }

  private async findIn(tx: ScopedTransaction, tenantId: string, assignmentId: string): Promise<AssignmentRow> {
    const row = await tx.roleAssignment.findFirst({ where: { id: assignmentId, tenantId }, include: ASSIGNMENT_INCLUDE });
    if (!row) throw new NotFoundException('Role Assignment not found');
    return row;
  }

  private async viewIn(tx: ScopedTransaction, tenantId: string, assignmentId: string): Promise<RoleAssignmentView> {
    const row = await this.findIn(tx, tenantId, assignmentId);
    return toView(row, await enabledApplications(tx, tenantId, [row.applicationId]), new Date());
  }

  /** Assignment changes join the Tenant's chain with the User as target, so the Audit Log's user filter finds them. */
  private recordIn(
    tx: ScopedTransaction,
    eventType: AuditEventType,
    actorUserId: string,
    assignment: {
      readonly id: string;
      readonly tenantId: string;
      readonly userId: string;
      readonly membershipId: string | null;
      readonly applicationId: string;
    },
    roleName: string,
    applicationName: string,
    payload: AuditPayload,
  ): Promise<void> {
    return this.audit.recordIn(tx, {
      tenantId: assignment.tenantId,
      eventType,
      actorUserId,
      target: { type: 'user', id: assignment.userId },
      applicationId: assignment.applicationId,
      payload: {
        roleAssignmentId: assignment.id,
        membershipId: assignment.membershipId,
        role: roleName,
        application: applicationName,
        ...payload,
      },
    });
  }
}

async function enabledApplications(
  tx: ScopedTransaction,
  tenantId: string,
  applicationIds: readonly string[],
): Promise<ReadonlySet<string>> {
  const unique = [...new Set(applicationIds)];
  if (unique.length === 0) return new Set();
  const enablements = await tx.enablement.findMany({
    where: { tenantId, applicationId: { in: unique }, disabledAt: null },
    select: { applicationId: true },
  });
  return new Set(enablements.map((enablement) => enablement.applicationId));
}
