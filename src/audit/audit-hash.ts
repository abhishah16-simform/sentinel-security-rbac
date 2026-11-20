import { createHash } from 'node:crypto';

/** The previous hash of the first entry in every chain. */
export const GENESIS_HASH = '0'.repeat(64);

/** The key of the platform chain's head row. Tenant chains use the Tenant's ID. */
export const PLATFORM_CHAIN = 'platform';

/** The fields of an entry that its hash covers. */
export interface HashedEntry {
  readonly id: string;
  readonly tenantId: string | null;
  readonly seq: number;
  readonly eventType: string;
  readonly actorUserId: string | null;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly applicationId: string | null;
  readonly payload: unknown;
  readonly createdAt: Date;
}

/**
 * JSON with object keys sorted at every level and no whitespace, so the same value always gives
 * the same text. This matters because Postgres jsonb doesn't keep the key order it was given.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Audit entries cannot hold non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item: unknown) => canonicalJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    const fields = Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${fields.join(',')}}`;
  }
  throw new TypeError(`Audit entries cannot hold a value of type ${typeof value}`);
}

/** hash = SHA-256(prevHash || canonical JSON of the entry), in hex. */
export function entryHash(prevHash: string, entry: HashedEntry): string {
  const canonical = canonicalJson({ ...entry, createdAt: entry.createdAt.toISOString() });
  return createHash('sha256').update(prevHash).update(canonical).digest('hex');
}
