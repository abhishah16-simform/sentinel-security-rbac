import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { type ScopedTransaction, setTenantContext } from '../prisma/scoped-prisma';
import type { AuditEventType } from './audit-event-types';
import { entryHash, GENESIS_HASH, type HashedEntry, PLATFORM_CHAIN } from './audit-hash';

/** Payload values are kept flat and JSON-safe so the stored jsonb hashes the same when read back. */
export type AuditPayload = Readonly<Record<string, string | number | boolean | null>>;

export interface AuditTarget {
  readonly type: 'user' | 'tenant' | 'session';
  readonly id: string;
}

export interface AuditEventInput {
  /** The Tenant whose chain the entry joins, or null for the platform chain. */
  readonly tenantId: string | null;
  readonly eventType: AuditEventType;
  /** The User who acted, or null when nobody is known. */
  readonly actorUserId: string | null;
  readonly target?: AuditTarget;
  readonly applicationId?: string;
  readonly payload?: AuditPayload;
}

/**
 * A platform-chain entry about one User, such as a login, MFA or password change. The actor is
 * whoever acted: usually the User, null when nobody known did (a lock, a reset request).
 */
export function userEvent(
  actorUserId: string | null,
  userId: string,
  eventType: AuditEventType,
  payload?: AuditPayload,
): AuditEventInput {
  return { tenantId: null, eventType, actorUserId, target: { type: 'user', id: userId }, payload };
}

interface ChainHead {
  readonly seq: number;
  readonly hash: string;
}

interface TenantSetting {
  readonly value: string | null;
}

/**
 * The one writer for the Audit Log. Every entry joins a hash chain: its Tenant's, or the platform
 * chain when it has no Tenant. Writes to one chain are serialized by locking its head row until
 * the transaction ends.
 */
@Injectable()
export class AuditLog {
  constructor(private readonly prisma: PrismaService) {}

  /** Writes an entry in a transaction of its own. */
  record(event: AuditEventInput): Promise<void> {
    return this.prisma.$transaction((tx) => this.recordIn(tx, event));
  }

  /**
   * Writes an entry inside the caller's transaction, so it commits or rolls back with the change it
   * records. The chain head stays locked until that transaction ends: keep the rest of it short.
   * The transaction's Tenant context is switched to the entry's chain for the insert, then restored.
   */
  async recordIn(tx: ScopedTransaction, event: AuditEventInput): Promise<void> {
    const chain = event.tenantId ?? PLATFORM_CHAIN;
    const [previous] = await tx.$queryRaw<TenantSetting[]>`SELECT current_setting('app.tenant_id', true) AS value`;
    // RLS: Tenant entries need that Tenant's context, platform entries need none ('' reads as none).
    await setTenantContext(tx, event.tenantId ?? '');

    await tx.$executeRaw`
      INSERT INTO audit_chain_heads (chain, seq, hash, "updatedAt") VALUES (${chain}, 0, ${GENESIS_HASH}, now())
      ON CONFLICT (chain) DO NOTHING`;
    const [head] = await tx.$queryRaw<ChainHead[]>`
      SELECT seq, hash FROM audit_chain_heads WHERE chain = ${chain} FOR UPDATE`;
    if (!head) throw new Error(`Audit chain head ${chain} is missing`);

    const entry: HashedEntry = {
      id: randomUUID(),
      tenantId: event.tenantId,
      seq: head.seq + 1,
      eventType: event.eventType,
      actorUserId: event.actorUserId,
      targetType: event.target?.type ?? null,
      targetId: event.target?.id ?? null,
      applicationId: event.applicationId ?? null,
      payload: event.payload ?? {},
      createdAt: new Date(),
    };
    const hash = entryHash(head.hash, entry);
    await tx.auditEvent.create({ data: { ...entry, payload: event.payload ?? {}, prevHash: head.hash, hash } });
    await tx.auditChainHead.update({ where: { chain }, data: { seq: entry.seq, hash } });

    await setTenantContext(tx, previous?.value ?? '');
  }
}
