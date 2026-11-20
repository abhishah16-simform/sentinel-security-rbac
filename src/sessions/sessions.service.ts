import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { IdentityService } from '../identity/identity.service';
import { type ActiveTenantRef, TenancyService } from '../tenancy/tenancy.service';
import { ACCESS_TOKEN_TTL_SECONDS, AccessTokenService } from '../access-token/access-token.service';
import { type IssuedRefreshToken, RefreshTokenService } from './refresh-token.service';

export interface SessionTokens {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly refreshToken: IssuedRefreshToken;
}

/** Logging in, silent refresh and logging out. */
@Injectable()
export class SessionsService {
  constructor(
    private readonly identity: IdentityService,
    private readonly accessTokens: AccessTokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly tenancy: TenancyService,
  ) {}

  async login(email: string, password: string): Promise<SessionTokens> {
    const user = await this.identity.checkCredentials(email, password);
    if (!user) throw new UnauthorizedException('Invalid email or password');

    const refreshToken = await this.refreshTokens.startChain(user.id);
    return this.withAccessToken(user.id, null, refreshToken);
  }

  async refresh(refreshToken: string): Promise<SessionTokens> {
    const result = await this.refreshTokens.rotate(refreshToken);
    if (result.kind !== 'rotated') throw new UnauthorizedException('Invalid or expired refresh token');
    return this.withAccessToken(result.userId, result.activeTenant, result.next);
  }

  /**
   * Makes a Tenant the login's Active Tenant: uses the refresh token once and returns new tokens
   * in the same chain that carry the Tenant and Membership. The User must belong to the Tenant.
   */
  async switchTenant(refreshToken: string, tenantId: string): Promise<SessionTokens> {
    const userId = await this.refreshTokens.ownerOf(refreshToken);
    if (!userId) throw new UnauthorizedException('Invalid or expired refresh token');
    const membership = await this.tenancy.findMembership(userId, tenantId);
    if (!membership) throw new ForbiddenException('You are not a member of that Tenant.');

    const result = await this.refreshTokens.rotate(refreshToken, {
      tenantId: membership.tenantId,
      membershipId: membership.membershipId,
    });
    if (result.kind !== 'rotated') throw new UnauthorizedException('Invalid or expired refresh token');
    return this.withAccessToken(result.userId, result.activeTenant, result.next);
  }

  logout(refreshToken: string): Promise<void> {
    return this.refreshTokens.revokeChainOf(refreshToken);
  }

  logoutEverywhere(userId: string): Promise<void> {
    return this.refreshTokens.revokeAllForUser(userId);
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
