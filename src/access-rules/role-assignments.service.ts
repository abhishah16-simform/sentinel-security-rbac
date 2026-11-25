import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { loadSchemaIndexes, SchemaIndex } from '../applications/schema-index';
import { AuditLog } from '../audit/audit-log.service';
import {
  decodeTimeCursor,
  encodeTimeCursor,
  type Page,
  type PageQuery,
  pageSize,
  pageWindow,
  toPage,
} from '../common/pagination';
import { ScopedPrisma, type ScopedTransaction } from '../prisma/scoped-prisma';
import type { ExpiringReportQuery, RoleAssignmentListQuery, RoleAssignmentStatus } from './dto/role-assignment.dto';
import {
  activeAssignmentWhere,
  END_REASON_LABELS,
  type EndReasonLabel,
  recordAssignmentEvent,
  revocationData,
} from './role-assignment-ending';
import { ROLE_WITH_PERMISSIONS, type PermissionView, toRoleView } from './role-view';
import { lockTenant } from './tenant-lock';

/** Active Role Assignments one Membership may hold at once. */
export const MAX_ACTIVE_ASSIGNMENTS_PER_MEMBERSHIP = 200;

/** How far ahead an expiry time may be. */
const MAX_EXPIRY_YEARS = 10;

/** The expiring-soon report's look-ahead window when none is given, and the longest allowed. */
export const DEFAULT_LOOK_AHEAD_DAYS = 7;
export const MAX_LOOK_AHEAD_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

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
  readonly endReason: EndReasonLabel | null;
  /**
   * When the Scheduler marked an expired assignment and wrote it to the Audit Log; null until then.
   * It gives no access from expiresAt either way.
   */
  readonly expiryRecordedAt: Date | null;
}

/** One page of the expiring-soon or expired report. */
export interface ExpiryReportPage extends Page<RoleAssignmentView> {
  /** The moment the report was worked out. */
  readonly asOf: Date;
}

/** Active Temporary Role Assignments that expire within the look-ahead window, soonest first. */
export interface ExpiringSoonReport extends ExpiryReportPage {
  readonly withinDays: number;
  /** The end of the window: asOf plus withinDays. */
  readonly windowEnd: Date;
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

function toMember(row: { readonly membershipId: string | null; readonly userId: string; readonly user: UserName }): AssignedMember {
  return {
    membershipId: row.membershipId,
    userId: row.userId,
    email: row.user.email,
    firstName: row.user.firstName,
    lastName: row.user.lastName,
  };
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
    member: toMember(row),
    role: { id: row.role?.id ?? null, name: row.role?.name ?? row.roleName },
    application: { id: row.application.id, name: row.application.name, enabled: enabled.has(row.applicationId) },
    expiresAt: row.expiresAt,
    assignedByName: displayName(row.assignedBy),
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
    revokedByName: displayName(row.revokedBy),
    endReason: row.endReason === null ? null : END_REASON_LABELS[row.endReason],
    expiryRecordedAt: row.expiryRecordedAt,
  };
}

/** The look-ahead window in days: a whole number from 1 to MAX_LOOK_AHEAD_DAYS. */
function lookAheadDays(value: string | undefined): number {
  if (value === undefined) return DEFAULT_LOOK_AHEAD_DAYS;
  const days = Number(value);
  if (days < 1 || days > MAX_LOOK_AHEAD_DAYS) {
    throw new BadRequestException(`withinDays must be between 1 and ${MAX_LOOK_AHEAD_DAYS}`);
  }
  return days;
}

/** A keyset window over rows ordered by (expiresAt, id); the reports only list rows with an expiry. */
function expiryWindow(query: PageQuery, direction: 'asc' | 'desc') {
  const limit = pageSize(query.limit);
  const orderBy: Prisma.RoleAssignmentOrderByWithRelationInput[] = [{ expiresAt: direction }, { id: direction }];
  if (query.cursor === undefined) return { limit, take: limit + 1, orderBy, after: {} };
  const { time, id } = decodeTimeCursor(query.cursor);
  const beyond = direction === 'asc' ? { gt: time } : { lt: time };
  const beyondId = direction === 'asc' ? { gt: id } : { lt: id };
  const after: Prisma.RoleAssignmentWhereInput = { OR: [{ expiresAt: beyond }, { expiresAt: time, id: beyondId }] };
  return { limit, take: limit + 1, orderBy, after };
}

function toExpiryPage(
  rows: readonly AssignmentRow[],
  limit: number,
  enabled: ReadonlySet<string>,
  now: Date,
): Page<RoleAssignmentView> {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => toView(row, enabled, now)),
    nextCursor: rows.length > limit && last?.expiresAt ? encodeTimeCursor({ time: last.expiresAt, id: last.id }) : null,
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

  /**
   * Expiring soon: active Temporary Role Assignments whose expiry time falls within the next
   * withinDays days (default DEFAULT_LOOK_AHEAD_DAYS), soonest first.
   */
  async expiringSoon(tenantId: string, query: ExpiringReportQuery): Promise<ExpiringSoonReport> {
    const withinDays = lookAheadDays(query.withinDays);
    const window = expiryWindow(query, 'asc');
    const now = new Date();
    const windowEnd = new Date(now.getTime() + withinDays * DAY_MS);
    return this.scoped.inTenant(tenantId, async (tx) => {
      const rows = await tx.roleAssignment.findMany({
        where: { AND: [{ tenantId, expiresAt: { lte: windowEnd } }, activeAssignmentWhere(now), window.after] },
        include: ASSIGNMENT_INCLUDE,
        orderBy: window.orderBy,
        take: window.take,
      });
      const enabled = await enabledApplications(tx, tenantId, rows.map((row) => row.applicationId));
      return { asOf: now, withinDays, windowEnd, ...toExpiryPage(rows, window.limit, enabled, now) };
    });
  }

  /** Expired Role Assignments (expiry passed, never revoked), most recently expired first. */
  async expired(tenantId: string, query: PageQuery): Promise<ExpiryReportPage> {
    const window = expiryWindow(query, 'desc');
    const now = new Date();
    return this.scoped.inTenant(tenantId, async (tx) => {
      const rows = await tx.roleAssignment.findMany({
        where: { AND: [{ tenantId }, statusWhere('expired', now), window.after] },
        include: ASSIGNMENT_INCLUDE,
        orderBy: window.orderBy,
        take: window.take,
      });
      const enabled = await enabledApplications(tx, tenantId, rows.map((row) => row.applicationId));
      return { asOf: now, ...toExpiryPage(rows, window.limit, enabled, now) };
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
      if (active.some((assignment) => assignment.roleId === role.id)) {
        throw new ConflictException(`${displayName(membership.user)} already has the Role "${role.name}". Revoke it first to change its expiry time.`);
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
      await recordAssignmentEvent(
        tx,
        this.audit,
        'role_assignment.created',
        actorUserId,
        { ...created, roleName: role.name, applicationName: role.application.name },
        { expiresAt: expiresAt === null ? null : expiresAt.toISOString() },
      );
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
      await tx.roleAssignment.update({ where: { id: row.id }, data: revocationData(now, actorUserId, 'REVOKED') });
      await recordAssignmentEvent(
        tx,
        this.audit,
        'role_assignment.revoked',
        actorUserId,
        { ...row, roleName: row.role?.name ?? row.roleName, applicationName: row.application.name },
        { reason: END_REASON_LABELS.REVOKED },
      );
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

      const applications = toEffectiveApplications(rows, schemas, enabled);

      return {
        member: toMember({ ...membership, membershipId: membership.id }),
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

type EffectiveRow = Prisma.RoleAssignmentGetPayload<{
  include: { application: { select: { name: true } }; role: { include: typeof ROLE_WITH_PERMISSIONS } };
}>;

/** "Invoice read": the pair a Deny Rule and an allow must share for the deny to always win. */
function ruleKey(permission: { readonly resourceType: string; readonly action: string }): string {
  return `${permission.resourceType}\u0000${permission.action}`;
}

/**
 * Groups the Permissions of a Membership's active assignments by Application, sorted by Application
 * name, then Resource Type, Action, allow before deny and Role name.
 */
function toEffectiveApplications(
  rows: readonly EffectiveRow[],
  schemas: ReadonlyMap<string, SchemaIndex>,
  enabled: ReadonlySet<string>,
): EffectiveApplication[] {
  const byApplication = new Map<string, { name: string; permissions: Omit<EffectivePermission, 'overriddenByDeny'>[] }>();
  for (const row of rows) {
    // An active assignment always has its Role (activeAssignmentWhere).
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
  return [...byApplication.entries()]
    .map(([id, entry]): EffectiveApplication => {
      const hardDenies = new Set(
        entry.permissions.filter((permission) => permission.inverted && permission.conditions === null).map(ruleKey),
      );
      const permissions = entry.permissions
        .map((permission) => ({ ...permission, overriddenByDeny: !permission.inverted && hardDenies.has(ruleKey(permission)) }))
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
}
