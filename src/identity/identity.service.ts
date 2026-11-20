import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import { generateOpaqueToken, hashOpaqueToken } from '../common/opaque-token';
import { isUniqueConstraintError } from '../common/prisma-errors';
import type { Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeEmail } from './email';
import { PasswordHasher } from './password-hasher';

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** What the rest of Sentinel may know about a User. Never includes the password hash. */
export interface UserProfile {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly emailVerified: boolean;
  readonly isPlatformAdmin: boolean;
}

export interface SignupInput {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly password: string;
}

function toProfile(user: User): UserProfile {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    emailVerified: user.emailVerifiedAt !== null,
    isPlatformAdmin: user.isPlatformAdmin,
  };
}

/** Users, signup, email verification and password checks. */
@Injectable()
export class IdentityService {
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordHasher,
    private readonly mail: MailService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true });
  }

  /**
   * Creates an unverified User and emails a verification link. If the email is already
   * taken, the response is the same and the owner is emailed instead, so signup can't be
   * used to find out which addresses have accounts.
   */
  async signup(input: SignupInput): Promise<void> {
    const { firstName, lastName, password } = input;
    const email = normalizeEmail(input.email);
    const passwordHash = await this.passwords.hash(password);

    let user: User;
    try {
      user = await this.prisma.user.create({ data: { email, firstName, lastName, passwordHash } });
    } catch (error: unknown) {
      if (!isUniqueConstraintError(error)) throw error;
      await this.notifyExistingAccount(email);
      return;
    }
    await this.sendVerificationEmail(user);
  }

  /** Marks the User verified if the token is valid, unused and unexpired. Each token works once. */
  async verifyEmail(token: string): Promise<void> {
    const now = new Date();
    const verified = await this.prisma.$transaction(async (tx) => {
      const record = await tx.emailVerificationToken.findUnique({ where: { tokenHash: hashOpaqueToken(token) } });
      if (!record || record.expiresAt <= now) return false;

      const claimed = await tx.emailVerificationToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count === 0) return false;

      await tx.user.updateMany({
        where: { id: record.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      });
      return true;
    });
    if (!verified) {
      throw new BadRequestException('This verification link is invalid, already used or expired.');
    }
  }

  /** Sends a fresh verification link to an unverified User. Silent for unknown or verified emails. */
  async resendVerification(rawEmail: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: normalizeEmail(rawEmail) } });
    if (user && user.emailVerifiedAt === null) {
      await this.sendVerificationEmail(user);
    }
  }

  /** Returns the User if the email and password match, or null. Takes similar time either way. */
  async checkCredentials(rawEmail: string, password: string): Promise<UserProfile | null> {
    const user = await this.prisma.user.findUnique({ where: { email: normalizeEmail(rawEmail) } });
    if (!user) {
      await this.passwords.verifyAgainstDummy(password);
      return null;
    }
    return (await this.passwords.verify(user.passwordHash, password)) ? toProfile(user) : null;
  }

  async getProfile(userId: string): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return toProfile(user);
  }

  private async sendVerificationEmail(user: User): Promise<void> {
    const token = generateOpaqueToken();
    await this.prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashOpaqueToken(token),
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
      },
    });
    // The token travels in the URL fragment, so it never reaches server logs or Referer headers.
    const link = `${this.appUrl}/verify-email.html#token=${token}`;
    await this.mail.send({
      to: user.email,
      subject: 'Verify your Sentinel email address',
      text: `Follow this link to verify your email address:\n\n${link}\n\nThe link works once and expires in 24 hours. If you didn't sign up for Sentinel, ignore this email.`,
    });
  }

  private async notifyExistingAccount(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;
    if (user.emailVerifiedAt === null) {
      await this.sendVerificationEmail(user);
      return;
    }
    await this.mail.send({
      to: user.email,
      subject: 'Someone tried to sign up with your email',
      text: `Someone tried to create a Sentinel account with this email address, but you already have one. You can log in at ${this.appUrl}/login.html.\n\nIf this wasn't you, you can ignore this email.`,
    });
  }
}
