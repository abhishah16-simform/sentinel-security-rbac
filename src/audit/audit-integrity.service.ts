import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { setTenantContext, type ScopedTransaction } from '../prisma/scoped-prisma';
import { entryHash, GENESIS_HASH, type HashedEntry, PLATFORM_CHAIN } from './audit-hash';

const BATCH_SIZE = 500;
const VERIFY_TIMEOUT_MS = 60_000;

export type ChainProblem =
  /** An entry is gone: the sequence skips a number, or ends before the chain head. */
  | 'missing-entry'
  /** Two entries share a sequence number, so one was not written by the audit writer. */
  | 'duplicate-entry'
  /** An entry's previous hash isn't the hash of the entry before it. */
  | 'prev-hash-mismatch'
  /** An entry's contents no longer match its own hash. */
  | 'hash-mismatch'
  /** The newest entry doesn't match the chain head's hash. */
  | 'head-mismatch'
  /** An entry sits beyond the chain head, so it wasn't written by the audit writer. */
  | 'entry-after-head';

export interface BrokenLink {
  readonly seq: number;
  /** The entry at fault, or null when the entry is missing. */
  readonly eventId: string | null;
  readonly problem: ChainProblem;
  readonly detail: string;
}

export interface IntegrityReport {
  readonly intact: boolean;
  readonly checkedEntries: number;
  /** The chain head: the newest entry's sequence number and hash. */
  readonly headSeq: number;
  readonly headHash: string;
  /** The first problem found walking from the start of the chain, or null when intact. */
  readonly firstBrokenLink: BrokenLink | null;
  readonly checkedAt: string;
}

const chainedEntrySelect = {
  id: true,
  tenantId: true,
  seq: true,
  eventType: true,
  actorUserId: true,
  targetType: true,
  targetId: true,
  applicationId: true,
  payload: true,
  createdAt: true,
  prevHash: true,
  hash: true,
} satisfies Prisma.AuditEventSelect;

type ChainedEntryRow = Prisma.AuditEventGetPayload<{ select: typeof chainedEntrySelect }>;

/** The first problem with one entry, given the hash and sequence number the chain expects. */
function checkEntry(row: ChainedEntryRow, expectedSeq: number, expectedPrevHash: string): BrokenLink | null {
  const { seq, prevHash, hash } = row;
  if (seq !== null && seq < expectedSeq) {
    // Tenant chains have a unique (tenantId, seq) index; the platform chain's null tenantId doesn't.
    return {
      seq,
      eventId: row.id,
      problem: 'duplicate-entry',
      detail: `Entry ${seq} appears more than once.`,
    };
  }
  if (seq === null || seq !== expectedSeq) {
    return {
      seq: expectedSeq,
      eventId: null,
      problem: 'missing-entry',
      detail: `Entry ${expectedSeq} is missing; the next entry found is ${seq ?? 'unnumbered'}.`,
    };
  }
  if (prevHash !== expectedPrevHash) {
    return {
      seq,
      eventId: row.id,
      problem: 'prev-hash-mismatch',
      detail: `Entry ${seq} does not point at the hash of entry ${seq - 1}.`,
    };
  }
  const hashed: HashedEntry = {
    id: row.id,
    tenantId: row.tenantId,
    seq,
    eventType: row.eventType,
    actorUserId: row.actorUserId,
    targetType: row.targetType,
    targetId: row.targetId,
    applicationId: row.applicationId,
    payload: row.payload,
    createdAt: row.createdAt,
  };
  if (hash !== entryHash(prevHash, hashed)) {
    return {
      seq,
      eventId: row.id,
      problem: 'hash-mismatch',
      detail: `Entry ${seq} was changed after it was written: its contents no longer match its hash.`,
    };
  }
  return null;
}

/** Walks an Audit Log hash chain from its first entry and reports the first broken link. */
@Injectable()
export class AuditIntegrity {
  constructor(private readonly prisma: PrismaService) {}

  /** Verifies a Tenant's chain, or the platform chain when tenantId is null. */
  verifyChain(tenantId: string | null): Promise<IntegrityReport> {
    // One REPEATABLE READ snapshot, so entries written during the walk can't look like tampering.
    return this.prisma.$transaction(
      async (tx) => {
        if (tenantId !== null) await setTenantContext(tx, tenantId);
        return this.walk(tx, tenantId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: VERIFY_TIMEOUT_MS },
    );
  }

  private async walk(tx: ScopedTransaction, tenantId: string | null): Promise<IntegrityReport> {
    const head = await tx.auditChainHead.findUnique({ where: { chain: tenantId ?? PLATFORM_CHAIN } });
    const headSeq = head?.seq ?? 0;
    const headHash = head?.hash ?? GENESIS_HASH;
    const report = (checkedEntries: number, firstBrokenLink: BrokenLink | null): IntegrityReport => ({
      intact: firstBrokenLink === null,
      checkedEntries,
      headSeq,
      headHash,
      firstBrokenLink,
      checkedAt: new Date().toISOString(),
    });

    let lastSeq = 0;
    let lastHash = GENESIS_HASH;
    let checked = 0;
    for (;;) {
      const rows = await tx.auditEvent.findMany({
        where: { tenantId, seq: { gt: lastSeq } },
        orderBy: { seq: 'asc' },
        take: BATCH_SIZE,
        select: chainedEntrySelect,
      });
      for (const row of rows) {
        if (row.seq !== null && row.seq > headSeq) {
          return report(checked, {
            seq: row.seq,
            eventId: row.id,
            problem: 'entry-after-head',
            detail: `Entry ${row.seq} comes after the chain head (entry ${headSeq}), so the audit writer did not write it.`,
          });
        }
        const broken = checkEntry(row, lastSeq + 1, lastHash);
        if (broken) return report(checked, broken);
        checked += 1;
        lastSeq = lastSeq + 1;
        lastHash = row.hash ?? '';
      }
      if (rows.length < BATCH_SIZE) break;
    }

    if (lastSeq < headSeq) {
      return report(checked, {
        seq: lastSeq + 1,
        eventId: null,
        problem: 'missing-entry',
        detail: `Entries ${lastSeq + 1} to ${headSeq} are missing from the end of the chain.`,
      });
    }
    if (lastHash !== headHash) {
      return report(checked, {
        seq: lastSeq,
        eventId: null,
        problem: 'head-mismatch',
        detail: `Entry ${lastSeq} does not match the hash recorded in the chain head.`,
      });
    }
    return report(checked, null);
  }
}
