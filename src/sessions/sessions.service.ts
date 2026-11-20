import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ACCESS_TOKEN_TTL_SECONDS, AccessTokenService } from '../access-token/access-token.service';
import { AuditLog } from '../audit/audit-log.service';
import { normalizeEmail } from '../identity/email';
import { IdentityService } from '../identity/identity.service';
import { AccountLockedException } from '../identity/lockout';
import { type MfaChallenge, MfaService } from '../identity/mfa.service';
import { PasswordResetService } from '../identity/password-reset.service';
import { PrismaService } from '../prisma/prisma.service';
import { type ActiveTenantRef, TenancyService } from '../tenancy/tenancy.service';
import { type IssuedRefreshToken, RefreshTokenService, type RotationResult } from './refresh-token.service';

export interface SessionTokens {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly refreshToken: IssuedRefreshToken;
}

/** A login either finishes at once or, with MFA on, waits for the emailed code. */
export type LoginResult =
  | { readonly kind: 'tokens'; readonly tokens: SessionTokens }
  | { readonly kind: 'mfa-required'; readonly challenge: MfaChallenge };

/** Logging in (with MFA), silent refresh, logging out and password reset. */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly mfa: MfaService,
    private readonly passwordReset: PasswordResetService,
    private readonly accessTokens: AccessTokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditLog,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const check = await this.identity.checkCredentials(email, password);
    if (check.kind !== 'valid') {
      // No Tenant is chosen before login, so failed logins go to the platform chain.
      const userId = check.kind === 'unknown-email' ? null : check.userId;
      await this.audit.record({
        tenantId: null,
        eventType: 'auth.login_failed',
        actorUserId: userId,
        target: userId === null ? undefined : { type: 'user', id: userId },
        payload: { email: normalizeEmail(email), reason: check.kind === 'locked' ? 'account-locked' : check.kind },
      });
      // Only the account's own lock is revealed; any other failure looks the same to the client.
      if (check.kind !== 'unknown-email' && check.lockedUntil) throw new AccountLockedException(check.lockedUntil);
      throw new UnauthorizedException('Invalid email or password');
    }

    const { user } = check;
    if (user.mfaEnabled) return { kind: 'mfa-required', challenge: await this.mfa.startLogin(user.id) };
    const refreshToken = await this.prisma.$transaction(async (tx) => {
      await this.identity.completeLogin(tx, user.id);
      return this.refreshTokens.startChainIn(tx, user.id, false);
    });
    return { kind: 'tokens', tokens: await this.withAccessToken(user.id, null, refreshToken) };
  }

  /** The second step of an MFA login: the emailed code for the token login returned. */
  async completeMfaLogin(mfaToken: string, code: string): Promise<SessionTokens> {
    const session = await this.mfa.completeLogin(mfaToken, code, (tx, userId) =>
      this.refreshTokens.startChainIn(tx, userId, true).then((token) => ({ userId, token })),
    );
    return this.withAccessToken(session.userId, null, session.token);
  }

  resendMfaCode(mfaToken: string): Promise<void> {
    return this.mfa.resendLoginCode(mfaToken);
  }

  /** Sets a new password from a reset link and code, and logs the User out everywhere. */
  resetPassword(token: string, code: string, newPassword: string): Promise<void> {
    return this.passwordReset.complete(token, code, newPassword, (tx, userId) => this.refreshTokens.revokeAllIn(tx, userId));
  }

  async refresh(refreshToken: string): Promise<SessionTokens> {
    return this.toSessionTokens(await this.refreshTokens.rotate(refreshToken));
  }

  /**
   * Makes a Tenant the login's Active Tenant: uses the refresh token once and returns new tokens
   * in the same chain that carry the Tenant and Membership. The User must belong to the Tenant.
   */
  async switchTenant(refreshToken: string, tenantId: string): Promise<SessionTokens> {
    const userId = await this.refreshTokens.ownerOfUsable(refreshToken);
    if (!userId) {
      // Still go through rotation so that a reused token revokes its chain; it never succeeds here.
      return this.toSessionTokens(await this.refreshTokens.rotate(refreshToken));
    }
    const membership = await this.tenancy.findMembership(userId, tenantId);
    if (!membership) throw new ForbiddenException('You are not a member of that Tenant.');

    return this.toSessionTokens(
      await this.refreshTokens.rotate(refreshToken, { tenantId: membership.tenantId, membershipId: membership.membershipId }),
    );
  }

  logout(refreshToken: string): Promise<void> {
    return this.refreshTokens.revokeChainOf(refreshToken);
  }

  logoutEverywhere(userId: string): Promise<void> {
    return this.refreshTokens.revokeAllForUser(userId);
  }

  private toSessionTokens(result: RotationResult): Promise<SessionTokens> {
    if (result.kind !== 'rotated') throw new UnauthorizedException('Invalid or expired refresh token');
    return this.withAccessToken(result.userId, result.activeTenant, result.next);
  }

  private async withAccessToken(
    userId: string,
    activeTenant: ActiveTenantRef | null,
    refreshToken: IssuedRefreshToken,
  ): Promise<SessionTokens> {
    // Re-read the User so flags like Platform Admin are current in every new access token.
    const user = await this.identity.getProfile(userId);
    const accessToken = await this.accessTokens.issue({
      sub: user.id,
      pa: user.isPlatformAdmin,
      tid: activeTenant?.tenantId,
      mid: activeTenant?.membershipId,
    });
    return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, refreshToken };
  }
}
