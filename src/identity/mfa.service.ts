import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuditLog, userEvent } from '../audit/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ScopedTransaction } from '../prisma/scoped-prisma';
import { CODE_TTL_MS, EmailChallenges } from './email-challenges';
import { Lockout } from './lockout';

/**
 * How long one MFA login attempt lasts. Longer than a code (10 minutes), so a resent code still
 * gets its full lifetime.
 */
const MFA_LOGIN_TTL_MS = 30 * 60 * 1000;

export interface MfaChallenge {
  /** Sent back with the code to finish logging in. */
  readonly mfaToken: string;
  readonly expiresIn: number;
}

/** Email-code MFA: switching it on and off, and the second step of logging in. */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly challenges: EmailChallenges,
    private readonly lockout: Lockout,
    private readonly audit: AuditLog,
  ) {}

  /** Switches MFA on. Only Users with a verified email may, since the code goes to that address. */
  async enable(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt === null) {
      throw new ForbiddenException('Verify your email address before turning on two-step verification.');
    }
    if (user.mfaEnabledAt !== null) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { mfaEnabledAt: new Date() } });
      await this.audit.recordIn(tx, userEvent(userId, userId, 'user.mfa_enabled'));
    });
  }

  /** Emails a code that confirms switching MFA off. */
  async sendDisableCode(userId: string): Promise<void> {
    await this.assertEnabled(userId);
    const { challenge } = await this.challenges.start(userId, 'MFA_DISABLE', { withToken: false, ttlMs: CODE_TTL_MS });
    await this.challenges.sendCode(challenge);
  }

  /** Switches MFA off, given a current code from sendDisableCode. */
  async disable(userId: string, code: string): Promise<void> {
    await this.assertEnabled(userId);
    const challenge = await this.challenges.findOpen(userId, 'MFA_DISABLE');
    if (!challenge) throw new BadRequestException('Ask for a code first.');
    await this.challenges.verify(challenge, code, async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { mfaEnabledAt: null } });
      await this.audit.recordIn(tx, userEvent(userId, userId, 'user.mfa_disabled'));
    });
  }

  /** After a correct password: emails a login code and returns the token that goes with it. */
  async startLogin(userId: string): Promise<MfaChallenge> {
    const { challenge, token } = await this.challenges.start(userId, 'MFA_LOGIN', { withToken: true, ttlMs: MFA_LOGIN_TTL_MS });
    if (token === null) throw new Error('An MFA login challenge must have a token');
    await this.challenges.sendCode(challenge);
    return { mfaToken: token, expiresIn: MFA_LOGIN_TTL_MS / 1000 };
  }

  /** Emails a new login code for the same login attempt (at most once a minute). */
  async resendLoginCode(mfaToken: string): Promise<void> {
    const challenge = await this.challenges.findByToken(mfaToken, 'MFA_LOGIN');
    if (!challenge) throw new UnauthorizedException('This login attempt has expired. Log in again.');
    await this.challenges.sendCode(challenge);
  }

  /**
   * Checks the login code. If it is right, clears the User's failures and runs startSession in the
   * same transaction, so the login and its session commit together.
   */
  async completeLogin<T>(
    mfaToken: string,
    code: string,
    startSession: (tx: ScopedTransaction, userId: string) => Promise<T>,
  ): Promise<T> {
    const challenge = await this.challenges.findByToken(mfaToken, 'MFA_LOGIN');
    if (!challenge) throw new UnauthorizedException('This login attempt has expired. Log in again.');
    return this.challenges.verify(challenge, code, async (tx) => {
      await this.lockout.clearFailures(tx, challenge.userId);
      return startSession(tx, challenge.userId);
    });
  }

  private async assertEnabled(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { mfaEnabledAt: true } });
    if (user.mfaEnabledAt === null) throw new BadRequestException('Two-step verification is already off.');
  }
}
