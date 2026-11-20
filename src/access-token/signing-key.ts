import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { calculateJwkThumbprint, exportJWK, type JWK } from 'jose';
import type { Env } from '../config/env';

export const ACCESS_TOKEN_ALGORITHM = 'RS256';
const MIN_RSA_MODULUS_BITS = 2048;

export interface JsonWebKeySet {
  readonly keys: readonly JWK[];
}

function loadRsaPrivateKey(path: string): KeyObject {
  let pem: string;
  try {
    pem = readFileSync(path, 'utf8');
  } catch (error: unknown) {
    throw new Error(
      `Could not read the access-token signing key at ${path}. Run "npm run keys:generate" or set JWT_PRIVATE_KEY_FILE.`,
      { cause: error },
    );
  }
  const key = createPrivateKey(pem);
  const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
  if (key.asymmetricKeyType !== 'rsa' || bits < MIN_RSA_MODULUS_BITS) {
    throw new Error(`The access-token signing key must be an RSA key of at least ${MIN_RSA_MODULUS_BITS} bits`);
  }
  return key;
}

/**
 * The RSA key pair that signs access tokens, loaded from configuration at startup. Its key ID
 * is the RFC 7638 thumbprint of the public key, so a new key always gets a new ID.
 */
@Injectable()
export class SigningKey {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  private publishedKey: Promise<JWK> | undefined;

  constructor(config: ConfigService<Env, true>) {
    this.privateKey = loadRsaPrivateKey(config.get('JWT_PRIVATE_KEY_FILE', { infer: true }));
    this.publicKey = createPublicKey(this.privateKey);
  }

  async keyId(): Promise<string> {
    const jwk = await this.publicJwk();
    return jwk.kid ?? '';
  }

  async jwks(): Promise<JsonWebKeySet> {
    return { keys: [await this.publicJwk()] };
  }

  private publicJwk(): Promise<JWK> {
    this.publishedKey ??= (async (): Promise<JWK> => {
      const jwk = await exportJWK(this.publicKey);
      const kid = await calculateJwkThumbprint(jwk);
      return { ...jwk, kid, alg: ACCESS_TOKEN_ALGORITHM, use: 'sig' };
    })();
    return this.publishedKey;
  }
}
