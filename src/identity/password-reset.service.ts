import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmailChallenge } from '@prisma/client';
import { AuditLog } from '../audit/audit-log.service';
import type { Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ScopedTransaction } from '../prisma/scoped-prisma';
import { normalizeEmail } from './email';
import { EmailChallenges } from './email-challenges';
import { Lockout } from './lockout';
import { PasswordHasher } from './password-hasher';

/** How long the emailed reset link works. The code it leads to lasts 10 minutes within that. */
export const RESET_LINK_TTL_MS = 60 * 60 * 1000;

/**
 * Password reset in three steps: an emailed link, then a fresh emailed code requested from the
 * page the link opens, then the code with the new password.
 */
@Injectable()
export class PasswordResetService {
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly challenges: EmailChallenges,
    private readonly passwords: PasswordHasher,
    private readonly lockout: Lockout,
    private readonly mail: MailService,
    private readonly audit: AuditLog,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true });
  }

  /** Emails a reset link. Silent for unknown emails, so it can't reveal which have accounts. */
  async request(rawEmail: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: normalizeEmail(rawEmail) } });
    if (!user) return;
    const { token } = await this.challenges.start(user.id, 'PASSWORD_RESET', { withToken: true, ttlMs: RESET_LINK_TTL_MS });
    await this.audit.record({
      tenantId: null,
      eventType: 'user.password_reset_requested',
      actorUserId: null,
      target: { type: 'user', id: user.id },
    });
    // The token travels in the URL fragment, so it never reaches server logs or Referer headers.
    await this.mail.send({
      to: user.email,
      subject: 'Reset your Sentinel password',
      text: `Follow this link to reset your password:\n\n${this.appUrl}/reset-password.html#token=${token}\n\nThe link works for an hour. On that page we'll email you a code as well. If you didn't ask to reset your password, ignore this email.`,
    });
  }

  /** Emails a fresh code for the reset the link belongs to. */
  async sendCode(token: string): Promise<void> {
    await this.challenges.sendCode(await this.findChallenge(token));
  }

  /**
   * Sets the new password if the code is right, then runs revokeSessions in the same transaction
   * so every refresh token the User holds stops working. Returns nothing the client needs.
   */
  async complete(
    token: string,
    code: string,
    newPassword: string,
    revokeSessions: (tx: ScopedTransaction, userId: string) => Promise<number>,
  ): Promise<void> {
    const challenge = await this.findChallenge(token);
    const passwordHash = await this.passwords.hash(newPassword);
    const { userId } = challenge;
    await this.challenges.verify(challenge, code, async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await this.lockout.clearFailures(tx, userId);
      const revokedSessions = await revokeSessions(tx, userId);
      await this.audit.recordIn(tx, {
        tenantId: null,
        eventType: 'user.password_reset',
        actorUserId: userId,
        target: { type: 'user', id: userId },
        payload: { revokedSessions },
      });
    });
  }

  private async findChallenge(token: string): Promise<EmailChallenge> {
    const challenge = await this.challenges.findByToken(token, 'PASSWORD_RESET');
    if (!challenge) throw new BadRequestException('This reset link is invalid, already used or expired.');
    return challenge;
  }
}
