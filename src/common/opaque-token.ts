import { createHash, randomBytes } from 'node:crypto';

/** A random, URL-safe token with 256 bits of entropy, given to the client and never stored. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The SHA-256 hash of an opaque token, which is all the database ever stores. */
export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
