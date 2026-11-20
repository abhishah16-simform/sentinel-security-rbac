import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { EmailChallenge, EmailChallengePurpose } from '@prisma/client';
import { AuditLog, userEvent } from '../audit/audit-log.service';
import { generateOpaqueToken, hashOpaqueToken } from '../common/opaque-token';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ScopedTransaction } from '../prisma/scoped-prisma';
import { AccountLockedException, Lockout, unwrapGuarded } from './lockout';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;
/** A new code can be emailed at most once a minute per challenge. */
export const RESEND_COOLDOWN_MS = 60 * 1000;
const CODE_TTL_MINUTES = CODE_TTL_MS / 60_000;

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
  | { readonly kind: 'wrong'; readonly attemptsLeft: number; readonly lockedUntil: Date | null };

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
 * 5 wrong attempts. Every wrong attempt also counts towards locking the account, and checks for one
 * User run one at a time (Lockout.guard).
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

  /**
   * Emails a fresh code for the challenge; any earlier code stops working. Refused while the
   * account is locked and within a minute of the previous code, so resends can't flood an inbox.
   */
  async sendCode(challenge: EmailChallenge): Promise<void> {
    const lockedUntil = await this.lockout.lockedUntil(challenge.userId);
    if (lockedUntil) throw new AccountLockedException(lockedUntil);
    const code = generateCode();
    const now = new Date();
    const purpose = PURPOSES[challenge.purpose];

    const email = await this.prisma.$transaction(async (tx) => {
      // Claim the send: only succeeds if no code went out in the last minute.
      const { count } = await tx.emailChallenge.updateMany({
        where: {
          id: challenge.id,
          usedAt: null,
          OR: [{ codeSentAt: null }, { codeSentAt: { lte: new Date(now.getTime() - RESEND_COOLDOWN_MS) } }],
        },
        data: {
          codeHash: hashCode(challenge.id, code),
          codeExpiresAt: new Date(now.getTime() + CODE_TTL_MS),
          codeSentAt: now,
          codeAttempts: 0,
        },
      });
      if (count === 0) return null;
      await this.audit.recordIn(tx, userEvent(challenge.userId, challenge.userId, 'auth.email_code_sent', { purpose: purpose.audit }));
      const user = await tx.user.findUniqueOrThrow({ where: { id: challenge.userId }, select: { email: true } });
      return user.email;
    });
    if (email === null) {
      throw new HttpException('A code was sent less than a minute ago. Check your inbox, or try again shortly.', HttpStatus.TOO_MANY_REQUESTS);
    }

    await this.mail.send({
      to: email,
      subject: purpose.subject,
      text: `Your code to ${purpose.action} is:\n\n${code}\n\nIt works once and expires in ${CODE_TTL_MINUTES} minutes. If you didn't ask for it, someone may know your password: change it, and don't share this code.`,
    });
  }

  /**
   * Checks a code and, if it is right, marks the challenge used and runs onValid in the same
   * transaction. A wrong code costs one of the code's 5 attempts and counts towards lockout.
   * Every refused attempt is audited. Throws 429 while the User is locked or another check for
   * them is running, and BadRequestException otherwise.
   */
  async verify<T>(
    challenge: EmailChallenge,
    code: string,
    onValid: (tx: ScopedTransaction) => Promise<T>,
  ): Promise<T> {
    const guarded = await this.lockout.guard(challenge.userId, async (tx): Promise<CodeOutcome<T>> => {
      const current = await tx.emailChallenge.findUnique({ where: { id: challenge.id } });
      const now = new Date();
      if (!current || current.usedAt !== null || current.expiresAt <= now) return { kind: 'invalid' };
      if (current.codeHash === null || current.codeExpiresAt === null || current.codeExpiresAt <= now) {
        return { kind: 'expired' };
      }
      if (current.codeAttempts >= MAX_CODE_ATTEMPTS) return { kind: 'exhausted' };
      if (!sameHash(current.codeHash, hashCode(current.id, code))) {
        await tx.emailChallenge.update({ where: { id: current.id }, data: { codeAttempts: { increment: 1 } } });
        const lockedUntil = await this.lockout.recordFailureIn(tx, challenge.userId, 'code');
        return { kind: 'wrong', attemptsLeft: MAX_CODE_ATTEMPTS - current.codeAttempts - 1, lockedUntil };
      }
      await tx.emailChallenge.update({ where: { id: current.id }, data: { usedAt: now } });
      return { kind: 'valid', result: await onValid(tx) };
    });

    const outcome = guarded.kind === 'ran' ? guarded.result : null;
    if (outcome?.kind === 'valid') return outcome.result;

    const reason = outcome === null ? (guarded.kind === 'locked' ? 'account-locked' : 'attempt-in-progress') : outcome.kind;
    await this.audit.record(
      userEvent(challenge.userId, challenge.userId, 'auth.email_code_failed', {
        purpose: PURPOSES[challenge.purpose].audit,
        reason,
        ...(outcome?.kind === 'wrong' ? { attemptsLeft: outcome.attemptsLeft } : {}),
      }),
    );

    const result = unwrapGuarded(guarded);
    switch (result.kind) {
      case 'invalid':
        throw new BadRequestException('This code request is no longer valid. Start again.');
      case 'expired':
        throw new BadRequestException('This code has expired. Ask for a new one.');
      case 'exhausted':
        throw new BadRequestException('Too many wrong attempts at this code. Ask for a new one.');
      case 'wrong':
        if (result.lockedUntil) throw new AccountLockedException(result.lockedUntil);
        throw new BadRequestException(
          result.attemptsLeft > 0
            ? `That code is wrong. ${result.attemptsLeft} ${result.attemptsLeft === 1 ? 'attempt' : 'attempts'} left.`
            : 'That code is wrong, and it no longer works. Ask for a new one.',
        );
      case 'valid':
        return result.result;
    }
  }
}
