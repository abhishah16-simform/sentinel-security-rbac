import { Injectable, UnauthorizedException } from '@nestjs/common';
import { IdentityService } from '../identity/identity.service';
import { ACCESS_TOKEN_TTL_SECONDS, AccessTokenService } from './access-token.service';
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
  ) {}

  async login(email: string, password: string): Promise<SessionTokens> {
    const user = await this.identity.checkCredentials(email, password);
    if (!user) throw new UnauthorizedException('Invalid email or password');

    const refreshToken = await this.refreshTokens.startChain(user.id);
    return this.withAccessToken(user.id, refreshToken);
  }

  async refresh(refreshToken: string): Promise<SessionTokens> {
    const result = await this.refreshTokens.rotate(refreshToken);
    if (result.kind !== 'rotated') throw new UnauthorizedException('Invalid or expired refresh token');
    return this.withAccessToken(result.userId, result.next);
  }

  logout(refreshToken: string): Promise<void> {
    return this.refreshTokens.revokeChainOf(refreshToken);
  }

  logoutEverywhere(userId: string): Promise<void> {
    return this.refreshTokens.revokeAllForUser(userId);
  }

  private async withAccessToken(userId: string, refreshToken: IssuedRefreshToken): Promise<SessionTokens> {
    // Re-read the User so flags like Platform Admin are current in every new access token.
    const user = await this.identity.getProfile(userId);
    const accessToken = await this.accessTokens.issue({ sub: user.id, pa: user.isPlatformAdmin });
    return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, refreshToken };
  }
}
