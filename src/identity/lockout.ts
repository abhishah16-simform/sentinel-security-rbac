import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AuditLog, userEvent } from '../audit/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ScopedTransaction } from '../prisma/scoped-prisma';

/** After this many failures within the window, the account locks. */
export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOCK_DURATION_MS = 15 * 60 * 1000;
/** Long enough for an argon2 check and a few writes; guarded work never waits on another request. */
const GUARD_TIMEOUT_MS = 15_000;

export type FailureKind = 'password' | 'code';

/** 429 for a locked account. Says how long the lock lasts, so the owner knows when to retry. */
export class AccountLockedException extends HttpException {
  constructor(lockedUntil: Date) {
    const minutes = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000));
    super(
      `Too many failed attempts. Your account is locked for ${minutes} more minute${minutes === 1 ? '' : 's'}.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** 429 when another password or code check for the same account is still running. */
export class AttemptInProgressException extends HttpException {
  constructor() {
    super('Another attempt for this account is in progress. Try again in a moment.', HttpStatus.TOO_MANY_REQUESTS);
  }
}

/** The outcome of guarded work: refused because another check is running or the account is locked, or run. */
export type Guarded<T> =
  | { readonly kind: 'busy' }
  | { readonly kind: 'locked'; readonly lockedUntil: Date }
  | { readonly kind: 'ran'; readonly result: T };

function activeLock(lockedUntil: Date | null): Date | null {
  return lockedUntil && lockedUntil > new Date() ? lockedUntil : null;
}

/** Throws the HTTP error for a refused guard, or returns what the work returned. */
export function unwrapGuarded<T>(outcome: Guarded<T>): T {
  if (outcome.kind === 'busy') throw new AttemptInProgressException();
  if (outcome.kind === 'locked') throw new AccountLockedException(outcome.lockedUntil);
  return outcome.result;
}

/**
 * Counts wrong passwords and codes per User in Postgres and locks the account for 15 minutes
 * after 5 failures within 15 minutes. Failures from before the last lock ended don't count again.
 *
 * Every password or code check runs inside guard(), which lets one check per User run at a time.
 * Otherwise parallel guesses could all pass the lock check before any of their failures counted.
 */
@Injectable()
export class Lockout {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLog,
  ) {}

  /**
   * Runs work in a transaction that holds the User's attempt lock and only if the account isn't
   * locked. A concurrent check for the same User is refused at once (busy) rather than queued,
   * so a burst of guesses can't tie up database connections.
   */
  guard<T>(userId: string, work: (tx: ScopedTransaction) => Promise<T>): Promise<Guarded<T>> {
    return this.prisma.$transaction(
      async (tx): Promise<Guarded<T>> => {
        const [attempt] = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${`attempt:${userId}`}, 0)) AS acquired`;
        if (!attempt?.acquired) return { kind: 'busy' };
        const user = await tx.user.findUnique({ where: { id: userId }, select: { lockedUntil: true } });
        const lockedUntil = activeLock(user?.lockedUntil ?? null);
        if (lockedUntil) return { kind: 'locked', lockedUntil };
        return { kind: 'ran', result: await work(tx) };
      },
      { timeout: GUARD_TIMEOUT_MS },
    );
  }

  /** When the User's lock ends, or null if they aren't locked now. For checks that guess nothing. */
  async lockedUntil(userId: string): Promise<Date | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { lockedUntil: true } });
    return activeLock(user?.lockedUntil ?? null);
  }

  /**
   * Records one failure inside guarded work and locks the account if this is the 5th within the
   * window. Returns the lock's end if the account is now locked.
   */
  async recordFailureIn(tx: ScopedTransaction, userId: string, kind: FailureKind): Promise<Date | null> {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { lockedUntil: true } });
    if (!user) return null;
    const now = new Date();
    await tx.authFailure.create({ data: { userId, kind, createdAt: now } });

    const windowStart = new Date(now.getTime() - FAILURE_WINDOW_MS);
    const since = user.lockedUntil && user.lockedUntil > windowStart ? user.lockedUntil : windowStart;
    const failures = await tx.authFailure.count({ where: { userId, createdAt: { gt: since } } });
    if (failures < MAX_FAILURES) return null;

    const lockedUntil = new Date(now.getTime() + LOCK_DURATION_MS);
    await tx.user.update({ where: { id: userId }, data: { lockedUntil } });
    await this.audit.recordIn(
      tx,
      userEvent(null, userId, 'auth.account_locked', { lockedUntil: lockedUntil.toISOString(), failures, lastFailure: kind }),
    );
    return lockedUntil;
  }

  /** Forgets the User's failures after a full login or a password reset. */
  async clearFailures(tx: ScopedTransaction, userId: string): Promise<void> {
    await tx.authFailure.deleteMany({ where: { userId } });
  }
}
