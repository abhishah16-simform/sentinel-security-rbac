import { randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { errors, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { ACCESS_TOKEN_ALGORITHM, SigningKey } from './signing-key';

export const ACCESS_TOKEN_TTL_SECONDS = 10 * 60;

/** The verified contents of an access token. */
export interface AccessTokenClaims {
  /** User ID */
  readonly sub: string;
  /** Active Tenant ID; absent until a Tenant is chosen */
  readonly tid?: string;
  /** Membership ID in the Active Tenant; absent until a Tenant is chosen */
  readonly mid?: string;
  /** Platform Admin flag */
  readonly pa: boolean;
  readonly jti: string;
  readonly iat: number;
  readonly exp: number;
}

export type AccessTokenSubject = Pick<AccessTokenClaims, 'sub' | 'tid' | 'mid' | 'pa'>;

function optionalStringClaim(payload: JWTPayload, name: string): string | undefined {
  const value = payload[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new UnauthorizedException('Malformed access token');
  return value;
}

function toClaims(payload: JWTPayload): AccessTokenClaims {
  const { sub, jti, iat, exp, pa } = payload;
  if (
    typeof sub !== 'string' ||
    typeof jti !== 'string' ||
    typeof iat !== 'number' ||
    typeof exp !== 'number' ||
    typeof pa !== 'boolean'
  ) {
    throw new UnauthorizedException('Malformed access token');
  }
  return { sub, jti, iat, exp, pa, tid: optionalStringClaim(payload, 'tid'), mid: optionalStringClaim(payload, 'mid') };
}

/** Issues and verifies Sentinel's short-lived RS256 access tokens. */
@Injectable()
export class AccessTokenService {
  constructor(private readonly signingKey: SigningKey) {}

  async issue(subject: AccessTokenSubject): Promise<string> {
    const claims: JWTPayload = { pa: subject.pa };
    if (subject.tid !== undefined) claims.tid = subject.tid;
    if (subject.mid !== undefined) claims.mid = subject.mid;

    return new SignJWT(claims)
      .setProtectedHeader({ alg: ACCESS_TOKEN_ALGORITHM, typ: 'JWT', kid: await this.signingKey.keyId() })
      .setSubject(subject.sub)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.signingKey.privateKey);
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.signingKey.publicKey, {
        algorithms: [ACCESS_TOKEN_ALGORITHM],
      });
      return toClaims(payload);
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException) throw error;
      if (error instanceof errors.JOSEError) throw new UnauthorizedException('Invalid or expired access token');
      throw error;
    }
  }
}
