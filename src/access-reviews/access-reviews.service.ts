import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AccessReviewOutcome, AccessReviewStatus, Prisma } from '@prisma/client';
import {
  activeAssignmentWhere,
  END_REASON_LABELS,
  isActiveAt,
  recordAssignmentEvent,
  revocationData,
  toAuditedAssignment,
} from '../access-rules/role-assignment-ending';
import { lockTenant } from '../access-rules/tenant-lock';
import { AuditLog } from '../audit/audit-log.service';
import { type Page, pageSize, pageWindow, toPage } from '../common/pagination';
import { ScopedPrisma, type ScopedTransaction } from '../prisma/scoped-prisma';
import type {
  AccessReviewListQuery,
  AccessReviewStatusLabel,
  ReviewItemListQuery,
  ReviewItemOutcomeLabel,
  StartAccessReviewDto,
} from './dto/access-review.dto';
import { recordItemEvent, resolveReviewItemsAsRevoked } from './review-item-resolution';

/** How far ahead a due date may be. */
const MAX_DUE_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Certified, revoked and pending counts: what is left to chase before the due date. */
export interface ReviewProgress {
  readonly total: number;
  readonly pending: number;
  readonly certified: number;
  readonly revoked: number;
  readonly autoRevoked: number;
}

export interface AccessReviewView {
  readonly id: string;
  readonly status: AccessReviewStatusLabel;
  readonly application: { readonly id: string; readonly name: string };
  readonly dueAt: Date;
  /** Open but past its due date: decisions are closed and the Scheduler is about to auto-revoke. */
  readonly pastDue: boolean;
  readonly startedByName: string | null;
  readonly createdAt: Date;
  readonly closedAt: Date | null;
  readonly progress: ReviewProgress;
}

/** One snapshotted Role Assignment and what became of it. */
export interface AccessReviewItemView {
  readonly id: string;
  readonly reviewId: string;
  readonly member: {
    /** Null once the Membership has ended. */
    readonly membershipId: string | null;
    readonly userId: string;
    readonly email: string;
    readonly firstName: string;
    readonly lastName: string;
  };
  /** id is null once the Role is deleted; name is then its last name. */
  readonly role: { readonly id: string | null; readonly name: string };
  readonly roleAssignment: {
    readonly id: string;
    /** As it stands now, not when the review started. */
    readonly status: 'active' | 'expired' | 'revoked';
    readonly expiresAt: Date | null;
    readonly createdAt: Date;
    readonly assignedByName: string | null;
  };
  readonly outcome: ReviewItemOutcomeLabel;
  readonly decidedAt: Date | null;
  /** The Tenant Admin who decided it; null while pending and for auto-revoked items. */
  readonly decidedByName: string | null;
}

const OUTCOME_LABELS = {
  CERTIFIED: 'certified',
  REVOKED: 'revoked',
  AUTO_REVOKED: 'auto-revoked',
} as const satisfies Record<AccessReviewOutcome, ReviewItemOutcomeLabel>;

const STATUS_LABELS = { OPEN: 'open', CLOSED: 'closed' } as const satisfies Record<AccessReviewStatus, AccessReviewStatusLabel>;

const USER_NAME = { select: { email: true, firstName: true, lastName: true } } as const;

const REVIEW_INCLUDE = {
  application: { select: { id: true, name: true } },
  startedBy: USER_NAME,
} as const satisfies Prisma.AccessReviewInclude;

type ReviewRow = Prisma.AccessReviewGetPayload<{ include: typeof REVIEW_INCLUDE }>;

const ITEM_INCLUDE = {
  decidedBy: USER_NAME,
  roleAssignment: {
    include: {
      user: USER_NAME,
      role: { select: { id: true, name: true } },
      assignedBy: USER_NAME,
    },
  },
} as const satisfies Prisma.AccessReviewItemInclude;

type ItemRow = Prisma.AccessReviewItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

/** An item being decided: its review's state and its Role Assignment, as audit entries describe it. */
const DECIDING_INCLUDE = {
  review: { select: { status: true, dueAt: true } },
  roleAssignment: {
    include: { role: { select: { name: true } }, application: { select: { name: true } } },
  },
} as const satisfies Prisma.AccessReviewItemInclude;

type DecidingItem = Prisma.AccessReviewItemGetPayload<{ include: typeof DECIDING_INCLUDE }>;

interface UserName {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
}

function displayName(user: UserName | null): string | null {
  if (!user) return null;
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
}

function emptyProgress(): { total: number; pending: number; certified: number; revoked: number; autoRevoked: number } {
  return { total: 0, pending: 0, certified: 0, revoked: 0, autoRevoked: 0 };
}

function toReviewView(row: ReviewRow, progress: ReviewProgress, now: Date): AccessReviewView {
  return {
    id: row.id,
    status: STATUS_LABELS[row.status],
    application: row.application,
    dueAt: row.dueAt,
    pastDue: row.status === 'OPEN' && row.dueAt <= now,
    startedByName: displayName(row.startedBy),
    createdAt: row.createdAt,
    closedAt: row.closedAt,
    progress,
  };
}

function toItemView(row: ItemRow, now: Date): AccessReviewItemView {
  const assignment = row.roleAssignment;
  let status: AccessReviewItemView['roleAssignment']['status'] = 'active';
  if (assignment.revokedAt !== null) status = 'revoked';
  else if (assignment.expiresAt !== null && assignment.expiresAt <= now) status = 'expired';
  return {
    id: row.id,
    reviewId: row.reviewId,
    member: {
      membershipId: assignment.membershipId,
      userId: assignment.userId,
      email: assignment.user.email,
      firstName: assignment.user.firstName,
      lastName: assignment.user.lastName,
    },
    role: { id: assignment.role?.id ?? null, name: assignment.role?.name ?? assignment.roleName },
    roleAssignment: {
      id: assignment.id,
      status,
      expiresAt: assignment.expiresAt,
      createdAt: assignment.createdAt,
      assignedByName: displayName(assignment.assignedBy),
    },
    outcome: row.outcome === null ? 'pending' : OUTCOME_LABELS[row.outcome],
    decidedAt: row.decidedAt,
    decidedByName: displayName(row.decidedBy),
  };
}

function outcomeWhere(outcome: ReviewItemOutcomeLabel | undefined): Prisma.AccessReviewItemWhereInput {
  switch (outcome) {
    case undefined:
      return {};
    case 'pending':
      return { outcome: null };
    case 'certified':
      return { outcome: 'CERTIFIED' };
    case 'revoked':
      return { outcome: 'REVOKED' };
    case 'auto-revoked':
      return { outcome: 'AUTO_REVOKED' };
  }
}

/** Items are paged by their position in the review; the cursor is the last position shown. */
function afterPosition(cursor: string | undefined): Prisma.AccessReviewItemWhereInput {
  if (cursor === undefined) return {};
  if (!/^\d{1,9}$/.test(cursor)) throw new BadRequestException('cursor is not valid');
  return { position: { gt: Number(cursor) } };
}

/** The due date: in the future and at most MAX_DUE_DAYS ahead. */
function parseDueAt(value: string, now: Date): Date {
  const dueAt = new Date(value);
  if (Number.isNaN(dueAt.getTime())) throw new BadRequestException('dueAt is not a valid time');
  if (dueAt <= now) throw new BadRequestException('dueAt must be in the future');
  if (dueAt.getTime() > now.getTime() + MAX_DUE_DAYS * DAY_MS) {
    throw new BadRequestException(`dueAt must be within ${MAX_DUE_DAYS} days`);
  }
  return dueAt;
}

/** Counts each review's items by outcome. */
export async function reviewProgress(
  tx: ScopedTransaction,
  tenantId: string,
  reviewIds: readonly string[],
): Promise<ReadonlyMap<string, ReviewProgress>> {
  const progress = new Map<string, ReturnType<typeof emptyProgress>>();
  for (const id of reviewIds) progress.set(id, emptyProgress());
  if (reviewIds.length === 0) return progress;
  const groups = await tx.accessReviewItem.groupBy({
    by: ['reviewId', 'outcome'],
    where: { tenantId, reviewId: { in: [...reviewIds] } },
    _count: { _all: true },
  });
  for (const group of groups) {
    const entry = progress.get(group.reviewId);
    if (!entry) continue;
    const count = group._count._all;
    entry.total += count;
    if (group.outcome === null) entry.pending += count;
    else if (group.outcome === 'CERTIFIED') entry.certified += count;
    else if (group.outcome === 'REVOKED') entry.revoked += count;
    else entry.autoRevoked += count;
  }
  return progress;
}

/**
 * Access Reviews inside the Active Tenant, for its Tenant Admins: starting one for an enabled
 * Application, which snapshots its active Role Assignments as items, and Certifying or revoking each
 * item until the due date. Every change locks the Tenant row, like every other Role Assignment change,
 * so decisions can't race a revoke elsewhere or the Scheduler closing the review.
 */
@Injectable()
export class AccessReviewsService {
  constructor(
    private readonly scoped: ScopedPrisma,
    private readonly audit: AuditLog,
  ) {}

  /** Newest first, optionally only open or closed ones, or one Application's. */
  list(tenantId: string, query: AccessReviewListQuery): Promise<Page<AccessReviewView>> {
    const window = pageWindow(query, 'desc');
    const now = new Date();
    return this.scoped.inTenant(tenantId, async (tx) => {
      const rows = await tx.accessReview.findMany({
        where: {
          tenantId,
          ...(query.status ? { status: query.status === 'open' ? 'OPEN' : 'CLOSED' } : {}),
          ...(query.applicationId ? { applicationId: query.applicationId } : {}),
          ...window.after,
        },
        include: REVIEW_INCLUDE,
        orderBy: window.orderBy,
        take: window.take,
      });
      const progress = await reviewProgress(tx, tenantId, rows.slice(0, window.limit).map((row) => row.id));
      return toPage(rows, window, (row) => toReviewView(row, progress.get(row.id) ?? emptyProgress(), now));
    });
  }

  /**
   * Starts a review of one enabled Application, due at dueAt, and snapshots every Role Assignment
   * active in it now as an item. 409 if one is already open for the Application, or there is nothing
   * to review.
   */
  async start(tenantId: string, actorUserId: string, input: StartAccessReviewDto): Promise<AccessReviewView> {
    const now = new Date();
    const dueAt = parseDueAt(input.dueAt, now);
    return this.scoped.inTenant(tenantId, async (tx) => {
      await lockTenant(tx, tenantId);
      const application = await tx.application.findUnique({ where: { id: input.applicationId }, select: { id: true, name: true } });
      if (!application) throw new NotFoundException('Application not found');
      const enablement = await tx.enablement.findUnique({
        where: { tenantId_applicationId: { tenantId, applicationId: application.id } },
        select: { disabledAt: true },
      });
      if (!enablement || enablement.disabledAt !== null) {
        throw new ConflictException(`Enable ${application.name} before reviewing access to it`);
      }
      const open = await tx.accessReview.findFirst({
        where: { tenantId, applicationId: application.id, status: 'OPEN' },
        select: { dueAt: true },
      });
      if (open) {
        throw new ConflictException(
          `An Access Review of ${application.name} is already open (due ${open.dueAt.toISOString()}). Wait for it to close first.`,
        );
      }
      const assignments = await tx.roleAssignment.findMany({
        where: { tenantId, applicationId: application.id, ...activeAssignmentWhere(now) },
        select: { id: true, roleName: true, role: { select: { name: true } }, user: { select: { email: true } } },
      });
      if (assignments.length === 0) {
        throw new ConflictException(`Nobody holds a Role in ${application.name}, so there is nothing to review`);
      }
      // Grouped by member, so a reviewer sees each person's Roles together.
      const ordered = [...assignments].sort(
        (a, b) =>
          a.user.email.localeCompare(b.user.email) ||
          (a.role?.name ?? a.roleName).localeCompare(b.role?.name ?? b.roleName) ||
          a.id.localeCompare(b.id),
      );
      const review = await tx.accessReview.create({
        data: { tenantId, applicationId: application.id, dueAt, startedByUserId: actorUserId },
        include: REVIEW_INCLUDE,
      });
      await tx.accessReviewItem.createMany({
        data: ordered.map((assignment, index) => ({
          tenantId,
          reviewId: review.id,
          roleAssignmentId: assignment.id,
          position: index + 1,
        })),
      });
      await this.audit.recordIn(tx, {
        tenantId,
        eventType: 'access_review.started',
        actorUserId,
        target: { type: 'access_review', id: review.id },
        applicationId: application.id,
        payload: {
          accessReviewId: review.id,
          application: application.name,
          dueAt: dueAt.toISOString(),
          items: ordered.length,
        },
      });
      const progress = { ...emptyProgress(), total: ordered.length, pending: ordered.length };
      return toReviewView(review, progress, now);
    });
  }

  async get(tenantId: string, reviewId: string): Promise<AccessReviewView> {
    return this.scoped.inTenant(tenantId, async (tx) => {
      const row = await this.findReview(tx, tenantId, reviewId);
      const progress = await reviewProgress(tx, tenantId, [row.id]);
      return toReviewView(row, progress.get(row.id) ?? emptyProgress(), new Date());
    });
  }

  /**
   * The review's items in order (by member email, then Role name), optionally of one outcome. Each
   * says what was decided, when and by whom: once closed, this is the outcome report.
   */
  async items(tenantId: string, reviewId: string, query: ReviewItemListQuery): Promise<Page<AccessReviewItemView>> {
    const limit = pageSize(query.limit);
    const now = new Date();
    return this.scoped.inTenant(tenantId, async (tx) => {
      await this.findReview(tx, tenantId, reviewId);
      const rows = await tx.accessReviewItem.findMany({
        where: { AND: [{ tenantId, reviewId }, outcomeWhere(query.outcome), afterPosition(query.cursor)] },
        include: ITEM_INCLUDE,
        orderBy: { position: 'asc' },
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map((row) => toItemView(row, now)),
        nextCursor: rows.length > limit && last ? String(last.position) : null,
      };
    });
  }

  /** Confirms the Role Assignment should stay. It must still give access. */
  certify(tenantId: string, actorUserId: string, reviewId: string, itemId: string): Promise<AccessReviewItemView> {
    return this.decide(tenantId, reviewId, itemId, async (tx, item, now) => {
      if (!isActiveAt(item.roleAssignment, now)) {
        throw new ConflictException('This Role Assignment has expired and gives no access, so it can\'t be Certified. Revoke it to decide the item.');
      }
      await tx.accessReviewItem.update({
        where: { id: item.id },
        data: { outcome: 'CERTIFIED', decidedAt: now, decidedByUserId: actorUserId },
      });
      await recordItemEvent(tx, this.audit, 'access_review.item_certified', actorUserId, item);
    });
  }

  /** Ends the Role Assignment at once (if it still gives access) and records the item as revoked. */
  revoke(tenantId: string, actorUserId: string, reviewId: string, itemId: string): Promise<AccessReviewItemView> {
    return this.decide(tenantId, reviewId, itemId, async (tx, item, now) => {
      const assignment = item.roleAssignment;
      if (isActiveAt(assignment, now)) {
        await tx.roleAssignment.update({ where: { id: assignment.id }, data: revocationData(now, actorUserId, 'REVOKED') });
        await recordAssignmentEvent(tx, this.audit, 'role_assignment.revoked', actorUserId, toAuditedAssignment(assignment), {
          reason: END_REASON_LABELS.REVOKED,
          accessReviewId: item.reviewId,
        });
      }
      // The same path as a revoke from anywhere else, so the item is decided in one place.
      await resolveReviewItemsAsRevoked(tx, this.audit, tenantId, [assignment.id], actorUserId, now);
    });
  }

  /**
   * Locks the Tenant, checks the item can still be decided (review open, before the due date, item
   * undecided), runs the decision and returns the item as it now stands.
   */
  private decide(
    tenantId: string,
    reviewId: string,
    itemId: string,
    decision: (tx: ScopedTransaction, item: DecidingItem, now: Date) => Promise<void>,
  ): Promise<AccessReviewItemView> {
    return this.scoped.inTenant(tenantId, async (tx) => {
      await lockTenant(tx, tenantId);
      const now = new Date();
      const item = await tx.accessReviewItem.findFirst({
        where: { id: itemId, reviewId, tenantId },
        include: DECIDING_INCLUDE,
      });
      if (!item) throw new NotFoundException('Access Review item not found');
      if (item.review.status === 'CLOSED') throw new ConflictException('This Access Review is closed');
      if (item.review.dueAt <= now) {
        throw new ConflictException('This Access Review is past its due date: undecided items are being revoked automatically');
      }
      if (item.outcome !== null) {
        throw new ConflictException(`This item has already been decided (${OUTCOME_LABELS[item.outcome]})`);
      }
      await decision(tx, item, now);
      const row = await tx.accessReviewItem.findUniqueOrThrow({ where: { id: item.id }, include: ITEM_INCLUDE });
      return toItemView(row, now);
    });
  }

  private async findReview(tx: ScopedTransaction, tenantId: string, reviewId: string): Promise<ReviewRow> {
    const row = await tx.accessReview.findFirst({ where: { id: reviewId, tenantId }, include: REVIEW_INCLUDE });
    if (!row) throw new NotFoundException('Access Review not found');
    return row;
  }
}
