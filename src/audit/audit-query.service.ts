import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuditEvent, Prisma } from '@prisma/client';
import { IdentityService, type UserProfile } from '../identity/identity.service';
import { decodeCursor, encodeCursor, pageSize } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { ScopedPrisma, type ScopedTransaction } from '../prisma/scoped-prisma';
import { AUDIT_EVENT_TYPES, isAuditEventType } from './audit-event-types';
import type { ListAuditEventsQuery } from './dto/list-audit-events.dto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuditUserRef {
  readonly id: string;
  /** Null when the User no longer exists. */
  readonly email: string | null;
  readonly name: string | null;
}

export interface AuditEventView {
  readonly id: string;
  readonly occurredAt: string;
  readonly eventType: string;
  readonly eventLabel: string;
  readonly actor: AuditUserRef | null;
  readonly target: { readonly type: string; readonly id: string; readonly user?: AuditUserRef } | null;
  readonly applicationId: string | null;
  readonly payload: Prisma.JsonValue;
  /** Position in the hash chain, or null for entries that aren't chained. */
  readonly seq: number | null;
}

export interface AuditEventPage {
  readonly items: readonly AuditEventView[];
  /** Pass as cursor to get the next page; null on the last page. */
  readonly nextCursor: string | null;
}

export interface AuditEventTypeView {
  readonly type: string;
  readonly label: string;
}

function parseInstant(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value);
}

function userRef(id: string, profiles: ReadonlyMap<string, UserProfile>): AuditUserRef {
  const profile = profiles.get(id);
  if (!profile) return { id, email: null, name: null };
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  return { id, email: profile.email, name: name || null };
}

/** Searching the Audit Log, newest entries first. */
@Injectable()
export class AuditQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoped: ScopedPrisma,
    private readonly identity: IdentityService,
  ) {}

  eventTypes(): AuditEventTypeView[] {
    return Object.entries(AUDIT_EVENT_TYPES).map(([type, label]) => ({ type, label }));
  }

  /** One page of a Tenant's entries. */
  listForTenant(tenantId: string, query: ListAuditEventsQuery): Promise<AuditEventPage> {
    return this.list(query, tenantId, (where, take) => this.scoped.inTenant(tenantId, (tx) => this.find(tx, where, take)));
  }

  /** One page of the platform chain. Runs with no Tenant context, which RLS requires for it. */
  listPlatform(query: ListAuditEventsQuery): Promise<AuditEventPage> {
    return this.list(query, null, (where, take) => this.prisma.$transaction((tx) => this.find(tx, where, take)));
  }

  private async list(
    query: ListAuditEventsQuery,
    tenantId: string | null,
    findPage: (where: Prisma.AuditEventWhereInput, take: number) => Promise<AuditEvent[]>,
  ): Promise<AuditEventPage> {
    const limit = pageSize(query.limit);
    const from = parseInstant(query.from);
    const to = parseInstant(query.to);
    if (from && to && from >= to) throw new BadRequestException('from must be earlier than to');

    const conditions: Prisma.AuditEventWhereInput[] = [];
    if (query.user !== undefined) {
      const userId = await this.resolveUser(query.user);
      if (userId === null) return { items: [], nextCursor: null };
      conditions.push({ OR: [{ actorUserId: userId }, { targetType: 'user', targetId: userId }] });
    }
    if (query.cursor !== undefined) {
      const after = decodeCursor(query.cursor);
      conditions.push({
        OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }],
      });
    }
    // One row more than the page, to tell whether another page follows.
    const rows = await findPage(
      { tenantId, createdAt: { gte: from, lt: to }, eventType: query.eventType, applicationId: query.applicationId, AND: conditions },
      limit + 1,
    );

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: await this.toViews(page),
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    };
  }

  private find(tx: ScopedTransaction, where: Prisma.AuditEventWhereInput, take: number): Promise<AuditEvent[]> {
    return tx.auditEvent.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take });
  }

  /** A User ID as is, or the ID of the User with that email; null when no such User exists. */
  private async resolveUser(user: string): Promise<string | null> {
    const trimmed = user.trim();
    if (UUID_PATTERN.test(trimmed)) return trimmed.toLowerCase();
    return (await this.identity.findProfileByEmail(trimmed))?.id ?? null;
  }

  private async toViews(events: readonly AuditEvent[]): Promise<AuditEventView[]> {
    const userIds = new Set<string>();
    for (const event of events) {
      if (event.actorUserId) userIds.add(event.actorUserId);
      if (event.targetType === 'user' && event.targetId) userIds.add(event.targetId);
    }
    const profiles = new Map((await this.identity.findProfiles([...userIds])).map((p) => [p.id, p]));

    return events.map((event) => ({
      id: event.id,
      occurredAt: event.createdAt.toISOString(),
      eventType: event.eventType,
      eventLabel: isAuditEventType(event.eventType) ? AUDIT_EVENT_TYPES[event.eventType] : event.eventType,
      actor: event.actorUserId ? userRef(event.actorUserId, profiles) : null,
      target:
        event.targetType && event.targetId
          ? {
              type: event.targetType,
              id: event.targetId,
              ...(event.targetType === 'user' ? { user: userRef(event.targetId, profiles) } : {}),
            }
          : null,
      applicationId: event.applicationId,
      payload: event.payload,
      seq: event.seq,
    }));
  }
}
