import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { EmailChallenge, EmailChallengePurpose } from '@prisma/client';
import { AuditLog } from '../audit/audit-log.service';
import { generateOpaqueToken, hashOpaqueToken } from '../common/opaque-token';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ScopedTransaction } from '../prisma/scoped-prisma';
import { AccountLockedException, Lockout } from './lockout';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;

/** What each kind of code is for, as the email and the Audit Log put it. */
const PURPOSES: Readonly<Record<EmailChallengePurpose, { readonly audit: string; readonly subject: string; readonly action: string }>> = {
  MFA_LOGIN: { audit: 'mfa-login', subject: 'Your Sentinel login code', action: 'finish logging in' },
  MFA_DISABLE: { audit: 'mfa-disable', subject: 'Your code to turn off MFA', action: 'turn off two-step verification' },
  PASSWORD_RESET: { audit: 'password-reset', subject: 'Your Sentinel password reset code', action: 'reset your password' },
};

export interface StartedChallenge {
  readonly challenge: EmailChallenge;
  /** The opaque token to hand to the client, when the challenge has one. */
  readonly token: string | null;
}

type CodeOutcome<T> =
  | { readonly kind: 'valid'; readonly result: T }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'exhausted' }
  | { readonly kind: 'wrong'; readonly attemptsLeft: number };

function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Salted with the challenge ID, so equal codes in different challenges hash differently. */
function hashCode(challengeId: string, code: string): string {
  return createHash('sha256').update(`${challengeId}:${code}`).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * 6-digit email codes. A code is stored hashed, lasts 10 minutes, works once and allows at most
 * 5 wrong guesses. Every wrong guess also counts towards locking the account.
 */
@Injectable()
export class EmailChallenges {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditLog,
    private readonly lockout: Lockout,
  ) {}

  /** Starts a challenge, ending the User's earlier open ones for the same purpose. */
  async start(
    userId: string,
    purpose: EmailChallengePurpose,
    options: { readonly withToken: boolean; readonly ttlMs: number },
  ): Promise<StartedChallenge> {
    const token = options.withToken ? generateOpaqueToken() : null;
    const now = new Date();
    const challenge = await this.prisma.$transaction(async (tx) => {
      await tx.emailChallenge.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: now } });
      return tx.emailChallenge.create({
        data: {
          userId,
          purpose,
          tokenHash: token === null ? null : hashOpaqueToken(token),
          expiresAt: new Date(now.getTime() + options.ttlMs),
        },
      });
    });
    return { challenge, token };
  }

  /** The open challenge a client token belongs to, or null if it is unknown, used or expired. */
  findByToken(token: string, purpose: EmailChallengePurpose): Promise<EmailChallenge | null> {
    return this.prisma.emailChallenge.findFirst({
      where: { tokenHash: hashOpaqueToken(token), purpose, usedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  /** The User's newest open challenge for a purpose, or null. */
  findOpen(userId: string, purpose: EmailChallengePurpose): Promise<EmailChallenge | null> {
    return this.prisma.emailChallenge.findFirst({
      where: { userId, purpose, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Emails a fresh code for the challenge. Any earlier code stops working, and its guesses reset. */
  async sendCode(challenge: EmailChallenge): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: challenge.userId }, select: { email: true } });
    const code = generateCode();
    const codeExpiresAt = new Date(Math.min(Date.now() + CODE_TTL_MS, challenge.expiresAt.getTime()));
    const purpose = PURPOSES[challenge.purpose];
    await this.prisma.$transaction(async (tx) => {
      await tx.emailChallenge.update({
        where: { id: challenge.id },
        data: { codeHash: hashCode(challenge.id, code), codeExpiresAt, codeAttempts: 0 },
      });
      await this.audit.recordIn(tx, {
        tenantId: null,
        eventType: 'auth.email_code_sent',
        actorUserId: challenge.userId,
        target: { type: 'user', id: challenge.userId },
        payload: { purpose: purpose.audit },
      });
    });
    await this.mail.send({
      to: user.email,
      subject: purpose.subject,
      text: `Your code to ${purpose.action} is:\n\n${code}\n\nIt works once and expires in 10 minutes. If you didn't ask for it, someone may know your password: change it, and don't share this code.`,
    });
  }

  /**
   * Checks a code and, if it is right, marks the challenge used and runs onValid in the same
   * transaction. A wrong code costs one of the code's 5 guesses and counts towards lockout.
   * Throws AccountLockedException while the User is locked, and BadRequestException otherwise.
   */
  async verify<T>(
    challenge: EmailChallenge,
    code: string,
    onValid: (tx: ScopedTransaction) => Promise<T>,
  ): Promise<T> {
    await this.lockout.assertNotLocked(challenge.userId);

    const outcome = await this.prisma.$transaction(async (tx): Promise<CodeOutcome<T>> => {
      // Lock the challenge so concurrent guesses are counted one at a time.
      await tx.$executeRaw`SELECT 1 FROM email_challenges WHERE id = ${challenge.id}::uuid FOR UPDATE`;
      const current = await tx.emailChallenge.findUnique({ where: { id: challenge.id } });
      const now = new Date();
      if (!current || current.usedAt !== null || current.expiresAt <= now) return { kind: 'invalid' };
      if (current.codeHash === null || current.codeExpiresAt === null || current.codeExpiresAt <= now) {
        return { kind: 'expired' };
      }
      if (current.codeAttempts >= MAX_CODE_ATTEMPTS) return { kind: 'exhausted' };
      if (!sameHash(current.codeHash, hashCode(current.id, code))) {
        await tx.emailChallenge.update({ where: { id: current.id }, data: { codeAttempts: { increment: 1 } } });
        return { kind: 'wrong', attemptsLeft: MAX_CODE_ATTEMPTS - current.codeAttempts - 1 };
      }
      await tx.emailChallenge.update({ where: { id: current.id }, data: { usedAt: now } });
      return { kind: 'valid', result: await onValid(tx) };
    });

    if (outcome.kind === 'valid') return outcome.result;
    if (outcome.kind === 'invalid') throw new BadRequestException('This code request is no longer valid. Start again.');
    if (outcome.kind === 'expired') throw new BadRequestException('This code has expired. Ask for a new one.');
    if (outcome.kind === 'exhausted') {
      throw new BadRequestException('Too many wrong guesses at this code. Ask for a new one.');
    }

    await this.audit.record({
      tenantId: null,
      eventType: 'auth.email_code_failed',
      actorUserId: challenge.userId,
      target: { type: 'user', id: challenge.userId },
      payload: { purpose: PURPOSES[challenge.purpose].audit, attemptsLeft: outcome.attemptsLeft },
    });
    const lockedUntil = await this.lockout.recordFailure(challenge.userId, 'code');
    if (lockedUntil) throw new AccountLockedException(lockedUntil);
    throw new BadRequestException(
      outcome.attemptsLeft > 0
        ? `That code is wrong. ${outcome.attemptsLeft} ${outcome.attemptsLeft === 1 ? 'guess' : 'guesses'} left.`
        : 'That code is wrong, and it no longer works. Ask for a new one.',
    );
  }
}
