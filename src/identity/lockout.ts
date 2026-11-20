import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AuditLog } from '../audit/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ScopedTransaction } from '../prisma/scoped-prisma';

/** After this many failures within the window, the account locks. */
export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

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

/**
 * Counts wrong passwords and codes per User in Postgres and locks the account for 15 minutes
 * after 5 failures within 15 minutes. Failures from before the last lock ended don't count again.
 */
@Injectable()
export class Lockout {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLog,
  ) {}

  /** When the User's lock ends, or null if they aren't locked now. */
  async lockedUntil(userId: string): Promise<Date | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { lockedUntil: true } });
    return user?.lockedUntil && user.lockedUntil > new Date() ? user.lockedUntil : null;
  }

  /** Throws AccountLockedException while the User is locked. */
  async assertNotLocked(userId: string): Promise<void> {
    const until = await this.lockedUntil(userId);
    if (until) throw new AccountLockedException(until);
  }

  /**
   * Records one failure in a transaction of its own (so it sticks even though the request then
   * fails) and locks the account if this is the 5th within the window. Returns the lock's end if
   * the account is now locked.
   */
  recordFailure(userId: string, kind: FailureKind): Promise<Date | null> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize failures for one User so two at once can't both miss the threshold.
      const [user] = await tx.$queryRaw<{ lockedUntil: Date | null }[]>`
        SELECT "lockedUntil" FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      if (!user) return null;
      const now = new Date();
      await tx.authFailure.create({ data: { userId, kind, createdAt: now } });

      const windowStart = new Date(now.getTime() - FAILURE_WINDOW_MS);
      const since = user.lockedUntil && user.lockedUntil > windowStart ? user.lockedUntil : windowStart;
      const failures = await tx.authFailure.count({ where: { userId, createdAt: { gt: since } } });
      if (failures < MAX_FAILURES) return null;

      const lockedUntil = new Date(now.getTime() + LOCK_DURATION_MS);
      await tx.user.update({ where: { id: userId }, data: { lockedUntil } });
      await this.audit.recordIn(tx, {
        tenantId: null,
        eventType: 'auth.account_locked',
        actorUserId: null,
        target: { type: 'user', id: userId },
        payload: { lockedUntil: lockedUntil.toISOString(), failures, lastFailure: kind },
      });
      return lockedUntil;
    });
  }

  /** Forgets the User's failures after a full login or a password reset. */
  async clearFailures(tx: ScopedTransaction, userId: string): Promise<void> {
    await tx.authFailure.deleteMany({ where: { userId } });
  }
}
