import { CanActivate, createParamDecorator, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AccessTokenClaims, AccessTokenService } from './access-token.service';

interface AuthenticatedRequest extends Request {
  accessToken?: AccessTokenClaims;
}

function bearerToken(req: Request): string | undefined {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

/** Requires a valid Sentinel access token in the Authorization: Bearer header. */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly accessTokens: AccessTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(req);
    if (!token) throw new UnauthorizedException('Missing bearer access token');
    req.accessToken = await this.accessTokens.verify(token);
    return true;
  }
}

/** The verified access token claims of the current request. Only valid after AccessTokenGuard has run. */
export function currentClaimsOf(context: ExecutionContext): AccessTokenClaims {
  const claims = context.switchToHttp().getRequest<AuthenticatedRequest>().accessToken;
  if (!claims) throw new UnauthorizedException('Missing bearer access token');
  return claims;
}

/** The verified access token claims of the current request. Use only behind AccessTokenGuard. */
export const CurrentClaims = createParamDecorator((_data: unknown, context: ExecutionContext): AccessTokenClaims =>
  currentClaimsOf(context),
);
